import * as fs from 'node:fs';
import * as path from 'node:path';
import { FuzzApp, snapshotDocument } from './app';
import { appendCorpus, ensureDir, readCorpus, writeArtifacts } from './corpus';
import { generateSeedSequences, instantiateSequence } from './generator';
import { runInvariants } from './invariants';
import { judgeDocument, symptomStillPresent } from './judge';
import { loadLlmConfig } from './llm';
import { mutateSequence } from './mutator';
import { describeOp, pickRandomOp } from './ops';
import { PRNG } from './prng';
import { shrinkSequence } from './shrink';
import type { CorpusEntry, FuzzWorkerConfig, OpRecord, OpResult } from './types';

export type BugInfo =
  | { kind: 'crash'; message: string }
  | { kind: 'invariant'; violations: Array<string> }
  | { kind: 'semantic'; reason: string };

export type WalkOutcome =
  | { foundBug: true; bug: BugInfo; ops: Array<OpRecord>; app: FuzzApp }
  | { foundBug: false; ops: Array<OpRecord> };

export type LlmConfigOrNull = ReturnType<typeof loadLlmConfig>;

/** A walk can be seeded with an initial op sequence to explore around. */
export type InitialOps = {
  ops: Array<OpRecord>;
  expected?: Array<string>;
};

/**
 * Runs a single fuzz walk against a fresh app instance.
 *
 * If `startsWith` is provided its ops are executed first (corpus-mutation mode).
 * Otherwise the walk begins with random starter draws. Invariants and crashes
 * are checked after every op; the LLM judge (when enabled) runs every
 * `checkEvery` ops.
 */
export async function runWalk(
  config: FuzzWorkerConfig,
  seed: number,
  rng: PRNG,
  startsWith: InitialOps | null,
  llmConfig: LlmConfigOrNull,
): Promise<WalkOutcome> {
  const app = new FuzzApp(seed);
  const ops: Array<OpRecord> = [];

  const runOp = async (op: OpRecord): Promise<OpResult> => {
    const result = await app.runOp(op);
    ops.push(op);
    return result;
  };

  const inspect = async (): Promise<(WalkOutcome & { foundBug: true }) | null> => {
    const violations = runInvariants(app);
    if (violations.length > 0) {
      return { foundBug: true, bug: { kind: 'invariant', violations }, ops, app };
    }
    return null;
  };

  let step = 0;

  if (startsWith) {
    for (const op of startsWith.ops) {
      const result = await runOp(op);
      if (result.kind === 'error') {
        return { foundBug: true, bug: { kind: 'crash', message: result.message }, ops, app };
      }
      const bug = await inspect();
      if (bug) {
        return bug;
      }
      step += 1;
    }
  } else {
    const starterCount = rng.int(2, 4);
    for (let i = 0; i < starterCount; i += 1) {
      const op = pickRandomOp(app, rng);
      if (!op) {
        continue;
      }
      const result = await runOp(op);
      if (result.kind === 'error') {
        return { foundBug: true, bug: { kind: 'crash', message: result.message }, ops, app };
      }
      const bug = await inspect();
      if (bug) {
        return bug;
      }
      step += 1;
    }
  }

  for (; step < config.maxOpsPerRun; step += 1) {
    if (llmConfig && step > 0 && step % config.checkEvery === 0) {
      const verdict = await judgeDocument(llmConfig, app, ops, startsWith?.expected);
      if (verdict && verdict.verdict === 'broken') {
        console.log(`[fuzz] LLM judge says BROKEN after ${ops.length} ops: ${verdict.reason}`);
        return {
          foundBug: true,
          bug: { kind: 'semantic', reason: verdict.reason },
          ops,
          app,
        };
      }
    }

    const op = pickRandomOp(app, rng);
    if (!op) {
      continue;
    }

    const result = await runOp(op);

    if (result.kind === 'error') {
      console.log(`[fuzz] crash after ${ops.length} ops: ${result.message.split('\n')[0]}`);
      return { foundBug: true, bug: { kind: 'crash', message: result.message }, ops, app };
    }

    const bug = await inspect();
    if (bug) {
      console.log(
        `[fuzz] invariant violation after ${ops.length} ops (${bug.bug.kind === 'invariant' ? bug.bug.violations[0] : ''})`,
      );
      return bug;
    }
  }

  return { foundBug: false, ops };
}

/**
 * Handles a found bug: prints it, shrinks it (crash/invariant bugs via replay
 * oracle; semantic bugs via targeted LLM oracle), writes artifact files and
 * appends the minimized sequence to the shared corpus.
 */
export async function handleBug(
  config: FuzzWorkerConfig,
  outcome: WalkOutcome & { foundBug: true },
  llmConfig: LlmConfigOrNull,
): Promise<string> {
  const { bug, ops, app } = outcome;
  const caseId = `bug-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  let minimizedOps = ops;
  let shrunk = false;

  if (bug.kind === 'crash' || bug.kind === 'invariant') {
    const replayOracle = makeReplayOracle(config);
    const result = await shrinkSequence(ops, replayOracle, 80);
    minimizedOps = result.ops;
    shrunk = result.shrunk;
    console.log(
      `[fuzz] shrunk ${ops.length} ops -> ${minimizedOps.length} (${result.oracleCalls} oracle calls)`,
    );
  } else if (bug.kind === 'semantic' && llmConfig) {
    const symptomOracle = async (candidate: Array<OpRecord>): Promise<{ reproduces: boolean }> => {
      const freshApp = new FuzzApp(config.seed + Math.floor(Math.random() * 1e6));
      for (const op of candidate) {
        const r = await freshApp.runOp(op);
        if (r.kind === 'error') {
          return { reproduces: false };
        }
      }
      const still = await symptomStillPresent(llmConfig, freshApp, candidate, bug.reason);
      return { reproduces: still === true };
    };
    const result = await shrinkSequence(ops, symptomOracle, 12);
    minimizedOps = result.ops;
    shrunk = result.shrunk;
    console.log(
      `[fuzz] semantic shrink ${ops.length} ops -> ${minimizedOps.length} (${result.oracleCalls} oracle calls)`,
    );
  }

  const svg = app.exportSvg() ?? '';
  const snapshot = snapshotDocument(app);

  // Deduplicate: if an identical (kind + minimized ops) case already exists,
  // skip writing (the same DCEL bug gets hit by many walks).
  const signature = JSON.stringify({ kind: bug.kind, ops: minimizedOps });
  if (artifactExists(config.artifactsDir, signature)) {
    console.log(`[fuzz] duplicate bug (${bug.kind}) already reported, skipping`);
    appendDuplicateToCorpus(config, signature);
    return caseId;
  }

  const meta: Record<string, unknown> = {
    caseId,
    seed: app.seed,
    kind: bug.kind,
    opsCount: minimizedOps.length,
    fullOpsCount: ops.length,
    shrunk,
  };
  if (bug.kind === 'crash') {
    meta.message = bug.message.split('\n')[0];
    meta.fullError = bug.message;
  } else if (bug.kind === 'invariant') {
    meta.violations = bug.violations;
  } else {
    meta.reason = bug.reason;
  }

  const descriptions = minimizedOps
    .map((op, index) => `${index + 1}. ${describeOp(op)}`)
    .join('\n');
  const notes: Array<string> = [
    `Cad2d fuzz bug report: ${caseId}`,
    '',
    `Kind: ${bug.kind}`,
    bug.kind === 'crash'
      ? `Error: ${bug.message.split('\n')[0]}`
      : bug.kind === 'invariant'
        ? `Invariant violations:\n${bug.violations.join('\n')}`
        : `LLM reasoning:\n${bug.reason}`,
    '',
    `Full run: ${ops.length} ops, minimized: ${minimizedOps.length} ops.`,
    '',
    '## Minimized operation sequence',
    descriptions,
    '',
    '## Reproduction',
    `npx tsx fuzz/cli.ts repro fuzz/artifacts/${caseId}`,
  ];

  const dir = writeArtifacts(config.artifactsDir, caseId, {
    'meta.json': JSON.stringify(meta, null, 2),
    'ops.json': JSON.stringify(minimizedOps, null, 2),
    'ops.full.json': JSON.stringify(ops, null, 2),
    'state.json': JSON.stringify(snapshot, null, 2),
    'export.svg': svg,
    'notes.md': notes.filter((line) => typeof line !== 'undefined').join('\n'),
  });

  console.log(`[fuzz] WROTE BUG REPORT to ${dir}`);

  appendCorpus(config.corpusDir, {
    id: caseId,
    interest: `${bug.kind} bug discovered by fuzzing`,
    expected: [],
    ops: minimizedOps,
  });

  return caseId;
}

/** Chooses the starting ops for a walk: often a mutated corpus entry. */
export async function chooseInitialOps(
  config: FuzzWorkerConfig,
  rng: PRNG,
): Promise<InitialOps | null> {
  const corpus = readCorpus(config.corpusDir);
  if (corpus.length > 0 && rng.chance(0.7)) {
    const entry = rng.pick(corpus);
    const appSeed = idToSeed(entry.id, config.seed);
    const app = new FuzzApp(appSeed);
    for (const op of entry.ops) {
      await app.runOp(op);
    }
    return {
      ops: mutateSequence(entry.ops, app, rng),
      expected: entry.expected,
    };
  }
  return null;
}

function idToSeed(id: string, fallback: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash ^ fallback) >>> 0;
}

/**
 * If the corpus is empty and a prompt is provided, calls the LLM to generate
 * seed sequences and populates the corpus. Returns true if any seeds were added.
 */
export async function primeCorpus(
  config: FuzzWorkerConfig,
  prompt: string | null,
  llmConfig: LlmConfigOrNull,
): Promise<boolean> {
  ensureDir(config.corpusDir);
  if (!prompt || !llmConfig) {
    return false;
  }
  if (readCorpus(config.corpusDir).length > 0) {
    return false;
  }
  const generated = await generateSeedSequences(llmConfig, prompt);
  let added = 0;
  for (const gen of generated) {
    const app = new FuzzApp(Math.floor(Math.random() * 1e9));
    const ops = await instantiateSequence(app, gen.ops);
    if (ops && ops.length > 0) {
      appendCorpus(config.corpusDir, {
        id: `prompt-seed-${Date.now()}-${added}`,
        interest: gen.interest,
        expected: gen.expected,
        ops,
      });
      added += 1;
    }
  }
  console.log(`[fuzz] seeded corpus with ${added} LLM-generated sequences`);
  return added > 0;
}

function makeReplayOracle(config: FuzzWorkerConfig) {
  return async (candidate: Array<OpRecord>): Promise<{ reproduces: boolean }> => {
    const app = new FuzzApp(config.seed + Math.floor(Math.random() * 1e6));
    let failed = false;
    for (const op of candidate) {
      const result = await app.runOp(op);
      if (result.kind === 'error') {
        failed = true;
        break;
      }
      if (runInvariants(app).length > 0) {
        failed = true;
        break;
      }
    }
    if (!failed && runInvariants(app).length > 0) {
      failed = true;
    }
    return { reproduces: failed };
  };
}

/** Returns true when an existing artifact has the same (kind + ops) signature. */
function artifactExists(artifactsDir: string, signature: string): boolean {
  if (!fs.existsSync(artifactsDir)) {
    return false;
  }
  let seen = 0;
  for (const caseName of fs.readdirSync(artifactsDir)) {
    const dir = path.join(artifactsDir, caseName);
    if (!fs.statSync(dir).isDirectory()) {
      continue;
    }
    seen += 1;
    if (seen > 3000) {
      break;
    }
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as {
        kind?: string;
      };
      const ops = JSON.parse(
        fs.readFileSync(path.join(dir, 'ops.json'), 'utf8'),
      ) as Array<OpRecord>;
      if (JSON.stringify({ kind: meta.kind, ops }) === signature) {
        return true;
      }
    } catch {
      // Ignore malformed artifact dirs.
    }
  }
  return false;
}

/** Adds a duplicate finding to the corpus without creating an artifact. */
function appendDuplicateToCorpus(config: FuzzWorkerConfig, signature: string): void {
  try {
    const parsed = JSON.parse(signature) as { kind: string; ops: Array<OpRecord> };
    if (Array.isArray(parsed.ops)) {
      appendCorpus(config.corpusDir, {
        id: `dup-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        interest: `${parsed.kind} bug (duplicate finding)`,
        expected: [],
        ops: parsed.ops,
      });
    }
  } catch {
    // Non-fatal.
  }
}

export type { CorpusEntry };
