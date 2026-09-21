import type { Id } from '@/lib/entity';

/** A sheet coordinate pair in the sheet's default units. */
export type Point = { x: number; y: number };

/**
 * A reference to a constraint endpoint. Two forms:
 * - `free`: an absolute sheet position
 * - locked: a named keypoint on an existing geometry (identified by id)
 */
export type EndpointRef =
  | { type: 'free'; x: number; y: number }
  | { type: 'polygon-vertex'; id: Id; index: number }
  | { type: 'rectangle-keypoint'; id: Id; key: RectangleKeypointKey }
  | { type: 'ellipse-keypoint'; id: Id; key: string }
  | { type: 'datum'; id: Id };

export type RectangleKeypointKey =
  | 'upperLeft'
  | 'upperRight'
  | 'lowerLeft'
  | 'lowerRight'
  | 'center';

/**
 * A fully-concrete, replayable operation. Every op carries explicit target ids
 * and absolute coordinates, so replaying the same list of ops against a fresh
 * app deterministically reproduces the same document.
 */
export type OpRecord =
  // --- Drawing (via real tool handler methods) ---
  | { type: 'draw-polygon'; points: Array<Point>; closed: boolean }
  | { type: 'draw-rectangle'; first: Point; second: Point; centerMode: boolean }
  | { type: 'draw-ellipse'; first: Point; second: Point; centerMode: boolean }
  // --- Selection ---
  | { type: 'select'; ids: Array<Id> }
  | { type: 'clear-selection' }
  // --- Edit (via GeometryStore, recorded to history) ---
  | { type: 'translate'; ids: Array<Id>; dx: number; dy: number }
  | { type: 'move-vertex'; id: Id; segmentIndex: number; to: Point }
  | { type: 'move-control-point'; id: Id; segmentIndex: number; to: Point }
  | { type: 'insert-point-on-edge'; id: Id; segmentIndex: number; pos: Point }
  | { type: 'open-close-polygon'; ids: Array<Id> }
  // --- Convert / boolean / arrange (via ActionsManager, selection-based) ---
  | { type: 'convert-to-polygon'; ids: Array<Id> }
  | { type: 'flip-horizontal'; ids: Array<Id> }
  | { type: 'flip-vertical'; ids: Array<Id> }
  | { type: 'raise'; ids: Array<Id> }
  | { type: 'lower'; ids: Array<Id> }
  | { type: 'raise-to-top'; ids: Array<Id> }
  | { type: 'lower-to-bottom'; ids: Array<Id> }
  | { type: 'union'; ids: Array<Id> }
  | { type: 'difference'; ids: Array<Id> }
  | { type: 'intersection'; ids: Array<Id> }
  | { type: 'toggle-link-dimensions'; ids: Array<Id> }
  // --- Delete ---
  | { type: 'delete'; ids: Array<Id> }
  // --- Constraints ---
  | { type: 'add-linear-constraint'; pointA: EndpointRef; pointB: EndpointRef; lengthCm: number }
  | { type: 'add-horizontal-constraint'; pointA: EndpointRef; pointB: EndpointRef }
  | { type: 'add-vertical-constraint'; pointA: EndpointRef; pointB: EndpointRef }
  // --- Trim / split (via TrimSplitTool handler methods) ---
  | { type: 'trim-split'; point: Point }
  // --- History ---
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'undo-all' }
  // --- Low-level precise edit (for LLM seeds targeting degeneracies) ---
  | { type: 'nudge-vertex'; id: Id; segmentIndex: number; to: Point }
  // --- Sheet settings ---
  | { type: 'sheet-width'; cm: number }
  | { type: 'sheet-height'; cm: number }
  | { type: 'sheet-default-unit'; unit: UnitName }
  | { type: 'sheet-unit-places'; places: number };

export type UnitName = 'in' | 'ft' | 'cm' | 'mm' | 'm';

export const UNIT_NAMES: Array<UnitName> = ['in', 'ft', 'cm', 'mm', 'm'];

/** A log entry describing what an op did, for the human/LLM judge. */
export type OpLogEntry = {
  index: number;
  text: string;
};

export type OpResult =
  | { kind: 'ok' }
  | { kind: 'noop'; reason: string }
  | { kind: 'error'; message: string };

/**
 * A full corpus entry: a concrete op sequence that is known to reach an
 * interesting region of the state space, plus the prompt/expectation that
 * makes it interesting to the judge.
 */
export type CorpusEntry = {
  id: string;
  /** Short human-readable description of why this sequence is interesting. */
  interest: string;
  /** Optional: properties the final state is expected to have. Passed to the judge. */
  expected?: Array<string>;
  /** The concrete op sequence. */
  ops: Array<OpRecord>;
};

export type FuzzWorkerConfig = {
  seed: number;
  threads: number;
  checkEvery: number;
  maxOpsPerRun: number;
  maxBugsBeforeRestart: number;
  corpusDir: string;
  artifactsDir: string;
  llmEnabled: boolean;
  llmBaseUrl: string | null;
  llmApiKey: string | null;
  llmModel: string;
  llmRatePerMinute: number;
  /** Optional natural-language prompt used to seed the corpus with LLM-generated sequences. */
  prompt: string | null;
  /** Optional wall-clock budget in seconds; worker stops after this. */
  durationSeconds: number;
  /** When true the worker exits as soon as it finds its first bug (used by tests). */
  exitAfterBug: boolean;
};
