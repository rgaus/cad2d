import type { Id } from '@/lib/entity';
import type { FuzzApp } from './app';
import { FuzzApp as FuzzAppClass } from './app';
import { type ChatMessage, type LlmConfig, chatComplete, extractJsonObject } from './llm';
import { executeOp } from './ops';
import type { CorpusEntry, EndpointRef, OpRecord } from './types';

/**
 * LLM-generated op schema. Targets are referenced by the `tag` of an earlier
 * draw operation ("A", "B", ...) instead of concrete ids, since the LLM cannot
 * know future ids. Tags are resolved to real ids at replay time.
 */
export type GenEndpointRef =
  | { kind: 'free'; point: [number, number] }
  | { kind: 'keypoint'; tag: string; vertex?: number; key?: string };

export type GenOp =
  | { op: 'drawPolygon'; tag: string; points: Array<[number, number]>; closed: boolean }
  | {
      op: 'drawRectangle';
      tag: string;
      p1: [number, number];
      p2: [number, number];
      center?: boolean;
    }
  | { op: 'drawEllipse'; tag: string; p1: [number, number]; p2: [number, number]; center?: boolean }
  | { op: 'moveShape'; targets: Array<string>; dx: number; dy: number }
  | { op: 'moveVertex'; target: string; vertex: number; to: [number, number] }
  | { op: 'insertPointOnEdge'; target: string; edge: number; at: [number, number] }
  | { op: 'deleteShapes'; targets: Array<string> }
  | { op: 'booleanOp'; operation: 'union' | 'difference' | 'intersection'; targets: Array<string> }
  | { op: 'trimSplit'; point: [number, number] }
  | { op: 'toggleOpenClose'; targets: Array<string> }
  | { op: 'convertToPolygon'; targets: Array<string> }
  | { op: 'addLinearConstraint'; a: GenEndpointRef; b: GenEndpointRef; lengthCm: number }
  | { op: 'undo'; steps: number };

export type GeneratedSequence = {
  interest: string;
  expected: Array<string>;
  ops: Array<GenOp>;
};

export type GeneratorResponse = {
  sequences: Array<GeneratedSequence>;
};

const GENERATOR_SYSTEM_PROMPT = `You design interesting test scenarios for a 2D mechanical CAD drawing
app. Given a user's request, produce a list of operation sequences that would realize that scenario
(or closely related interesting degeneracies), plus a list of "expected properties" the final
document should satisfy.

Coordinate system: sheet coordinates in the default unit (cm; sheet ~21 x 29.7). Use x in [0,21],
y in [0,29.7]. Prefer small, easy-to-verify numbers.

You can use these operations. Each draw operation gives the created shape a unique tag ("A","B",...)
that later operations use to reference it:

- drawPolygon: {"op":"drawPolygon","tag":"A","points":[[x,y],...],"closed":true}
  3-5 distinct vertices. closed:true makes a filled closed polygon; closed:false an open polyline.
- drawRectangle: {"op":"drawRectangle","tag":"A","p1":[x1,y1],"p2":[x2,y2]}  (opposite corners)
- drawEllipse:  {"op":"drawEllipse","tag":"A","p1":[x1,y1],"p2":[x2,y2]}  (bounding box corners)
- moveShape: {"op":"moveShape","targets":["A"],"dx":d,"dy":d}  translate
- moveVertex: {"op":"moveVertex","target":"A","vertex":0,"to":[x,y]}  move one vertex exactly
- insertPointOnEdge: {"op":"insertPointOnEdge","target":"A","edge":0,"at":[x,y]}
- deleteShapes: {"op":"deleteShapes","targets":["A","B"]}
- booleanOp: {"op":"booleanOp","operation":"difference","targets":["A","B"]}  (union|difference|intersection)
- trimSplit: {"op":"trimSplit","point":[x,y]}  click at an intersection point to split/trim
- toggleOpenClose: {"op":"toggleOpenClose","targets":["A"]}
- convertToPolygon: {"op":"convertToPolygon","targets":["A"]}
- addLinearConstraint: {"op":"addLinearConstraint","a":{"kind":"keypoint","tag":"A","vertex":0},"b":{"kind":"free","point":[x,y]},"lengthCm":n}
- undo: {"op":"undo","steps":1}

Rules:
- Reference a tag only AFTER the op that created it.
- Operations that would obviously fail (like referencing a deleted tag) will be dropped, so keep
  sequences self-consistent.
- "expected" entries must be short, machine-checkable statements about the final document, e.g.
  "there is a closed polygon with a vertex exactly at (5, 10)", or "an edge of shape A passes exactly
  through a vertex of shape B".

Respond with JSON exactly in this shape:
{"sequences":[{"interest":"<why this is interesting>","expected":["..."],"ops":[ ... ]}]}`;

const MAX_SEQUENCES = 4;
const MAX_GEN_OPS_PER_SEQUENCE = 12;

/**
 * Calls the LLM to generate seed sequences for the given natural-language prompt.
 * Returns empty array when the LLM is unavailable.
 */
export async function generateSeedSequences(
  config: LlmConfig,
  prompt: string,
): Promise<Array<GeneratedSequence>> {
  try {
    const messages: Array<ChatMessage> = [
      { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Please generate sequences for this request:\n\n${prompt}`,
      },
    ];
    const content = await chatComplete(config, messages, { jsonMode: true });
    const parsed = extractJsonObject<Partial<GeneratorResponse>>(content);

    if (!Array.isArray(parsed.sequences)) {
      return [];
    }

    return parsed.sequences
      .slice(0, MAX_SEQUENCES)
      .map((seq) => ({
        interest: typeof seq.interest === 'string' ? seq.interest : 'llm-generated',
        expected: Array.isArray(seq.expected) ? seq.expected.map(String) : [],
        ops: Array.isArray(seq.ops) ? seq.ops.slice(0, MAX_GEN_OPS_PER_SEQUENCE) : [],
      }))
      .filter((seq) => seq.ops.length > 0);
  } catch (e) {
    console.warn(`[fuzz] seed generation failed: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
}

/**
 * Replays a generated (tagged) sequence against `app` and produces the concrete
 * OpRecord sequence. Ops that fail or reference unknown tags are dropped.
 * Returns the concrete ops actually executed, or null if nothing executed.
 */
export async function instantiateSequence(
  app: FuzzApp,
  genOps: Array<GenOp>,
): Promise<Array<OpRecord> | null> {
  const createdThisOp: Array<Id> = [];
  const onAdded = (geometry: { id: Id }) => {
    createdThisOp.push(geometry.id);
  };
  app.geometryStore.on('geometryAdded', onAdded);

  const tagToId = new Map<string, Id>();
  const concrete: Array<OpRecord> = [];

  try {
    for (const gen of genOps) {
      createdThisOp.length = 0;
      const record = toConcreteOp(gen, tagToId);
      if (!record) {
        continue;
      }
      const result = await executeOp(app, record);
      app.polishAfterOp();
      if (result.kind === 'error') {
        return null; // reject sequences that crash
      }
      concrete.push(record);
      switch (gen.op) {
        case 'drawPolygon':
        case 'drawRectangle':
        case 'drawEllipse':
          if (gen.tag && createdThisOp.length > 0) {
            tagToId.set(gen.tag, createdThisOp[createdThisOp.length - 1]);
          }
          break;
        default:
          break;
      }
    }
  } finally {
    app.geometryStore.off('geometryAdded', onAdded);
  }

  if (concrete.length === 0) {
    return null;
  }
  return concrete;
}

function toConcreteOp(gen: GenOp, tagToId: Map<string, Id>): OpRecord | null {
  const resolveTag = (tag: string): Id | null => {
    const id = tagToId.get(tag);
    return id ?? null;
  };
  const resolveEndpoint = (ref: GenEndpointRef): EndpointRef | null => {
    if (ref.kind === 'free') {
      const [x, y] = ref.point;
      return { type: 'free', x, y };
    }
    const id = resolveTag(ref.tag);
    if (!id) {
      return null;
    }
    if (ref.vertex !== undefined) {
      return { type: 'polygon-vertex', id, index: ref.vertex };
    }
    if (ref.key) {
      return { type: 'rectangle-keypoint', id, key: ref.key as never };
    }
    return { type: 'free', x: 1, y: 1 };
  };

  switch (gen.op) {
    case 'drawPolygon':
      return {
        type: 'draw-polygon',
        points: gen.points.map(([x, y]) => ({ x, y })),
        closed: gen.closed,
      };
    case 'drawRectangle': {
      const [x1, y1] = gen.p1;
      const [x2, y2] = gen.p2;
      return {
        type: 'draw-rectangle',
        first: { x: x1, y: y1 },
        second: { x: x2, y: y2 },
        centerMode: gen.center ?? false,
      };
    }
    case 'drawEllipse': {
      const [x1, y1] = gen.p1;
      const [x2, y2] = gen.p2;
      return {
        type: 'draw-ellipse',
        first: { x: x1, y: y1 },
        second: { x: x2, y: y2 },
        centerMode: gen.center ?? false,
      };
    }
    case 'moveShape': {
      const ids = gen.targets.map(resolveTag).filter((t): t is Id => t !== null);
      if (ids.length === 0) {
        return null;
      }
      return { type: 'translate', ids, dx: gen.dx, dy: gen.dy };
    }
    case 'moveVertex': {
      const id = resolveTag(gen.target);
      if (!id) {
        return null;
      }
      return {
        type: 'move-vertex',
        id,
        segmentIndex: gen.vertex,
        to: { x: gen.to[0], y: gen.to[1] },
      };
    }
    case 'insertPointOnEdge': {
      const id = resolveTag(gen.target);
      if (!id) {
        return null;
      }
      return {
        type: 'insert-point-on-edge',
        id,
        segmentIndex: gen.edge,
        pos: { x: gen.at[0], y: gen.at[1] },
      };
    }
    case 'deleteShapes': {
      const ids = gen.targets.map(resolveTag).filter((t): t is Id => t !== null);
      if (ids.length === 0) {
        return null;
      }
      return { type: 'delete', ids };
    }
    case 'booleanOp': {
      const ids = gen.targets.map(resolveTag).filter((t): t is Id => t !== null);
      if (ids.length < 2) {
        return null;
      }
      switch (gen.operation) {
        case 'union':
          return { type: 'union', ids };
        case 'difference':
          return { type: 'difference', ids };
        case 'intersection':
          return { type: 'intersection', ids };
      }
      return null;
    }
    case 'trimSplit': {
      const [x, y] = gen.point;
      return { type: 'trim-split', point: { x, y } };
    }
    case 'toggleOpenClose': {
      const ids = gen.targets.map(resolveTag).filter((t): t is Id => t !== null);
      if (ids.length === 0) {
        return null;
      }
      return { type: 'open-close-polygon', ids };
    }
    case 'convertToPolygon': {
      const ids = gen.targets.map(resolveTag).filter((t): t is Id => t !== null);
      if (ids.length === 0) {
        return null;
      }
      return { type: 'convert-to-polygon', ids };
    }
    case 'addLinearConstraint': {
      const a = resolveEndpoint(gen.a);
      const b = resolveEndpoint(gen.b);
      if (!a || !b) {
        return null;
      }
      return { type: 'add-linear-constraint', pointA: a, pointB: b, lengthCm: gen.lengthCm };
    }
    case 'undo':
      return { type: 'undo' };
    default:
      gen satisfies never;
      return null;
  }
}

/** Convenience: generate prompt-driven seeds and turn them into concrete CorpusEntries. */
export async function buildSeedCorpus(
  config: LlmConfig,
  prompt: string,
): Promise<Array<CorpusEntry>> {
  const generated = await generateSeedSequences(config, prompt);
  const entries: Array<CorpusEntry> = [];
  for (let i = 0; i < generated.length; i += 1) {
    const gen = generated[i];
    const app = new FuzzAppClass(Date.now() + i);
    const ops = await instantiateSequence(app, gen.ops);
    if (ops && ops.length > 0) {
      entries.push({
        id: `seed-${Date.now()}-${i}`,
        interest: gen.interest,
        expected: gen.expected,
        ops,
      });
    }
  }
  return entries;
}
