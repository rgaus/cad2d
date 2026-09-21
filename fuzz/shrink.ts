import type { OpRecord } from './types';

/**
 * A predicate on a candidate op sequence: does the bug still reproduce?
 * Implementations typically replay the sequence against a fresh app and check
 * for crashes / invariant violations, or re-ask the LLM about a symptom.
 */
export type Oracle = (candidateOps: Array<OpRecord>) => Promise<{ reproduces: boolean }>;

export type ShrinkResult = {
  /** The minimized sequence that still reproduces the bug. */
  ops: Array<OpRecord>;
  /** True if shrinking reduced the sequence at all. */
  shrunk: boolean;
  /** Number of oracle calls made while shrinking. */
  oracleCalls: number;
};

/**
 * Delta-debugging shrinker (`ddmin` style chunk deletions, then a granular
 * single-op pass). Ops that reference ids are safe because replaying a lover of
 * a sequence either reproduces the bug or not - broken references resolve at
 * replay time and simply cause the oracle to say "does not reproduce".
 */
export async function shrinkSequence(
  inputOps: Array<OpRecord>,
  oracle: Oracle,
  maxOracleCalls: number = 100,
): Promise<ShrinkResult> {
  let ops = inputOps.slice();
  let oracleCalls = 0;

  const guardedOracle = async (candidate: Array<OpRecord>): Promise<boolean> => {
    oracleCalls += 1;
    if (oracleCalls > maxOracleCalls) {
      return false;
    }
    const result = await oracle(candidate);
    return result.reproduces;
  };

  let granularity = 2;
  let changed = true;

  // Phase 1: ddmin-style chunk deletion
  while (ops.length >= 2) {
    if (!changed) {
      if (granularity >= ops.length) {
        break;
      }
      granularity = Math.min(ops.length, granularity * 2);
    }
    changed = false;

    const chunkSize = Math.max(1, Math.ceil(ops.length / granularity));
    for (let i = 0; i < ops.length && oracleCalls <= maxOracleCalls; i += chunkSize) {
      const candidate = [...ops.slice(0, i), ...ops.slice(i + chunkSize)];
      if (candidate.length === 0) {
        continue;
      }
      if (await guardedOracle(candidate)) {
        ops = candidate;
        granularity = Math.max(2, granularity - 1);
        changed = true;
        break;
      }
    }
  }

  // Phase 2: granular single-op deletions
  if (oracleCalls <= maxOracleCalls) {
    let i = 0;
    while (i < ops.length && oracleCalls <= maxOracleCalls) {
      const candidate = [...ops.slice(0, i), ...ops.slice(i + 1)];
      if (candidate.length > 0 && (await guardedOracle(candidate))) {
        ops = candidate;
      } else {
        i += 1;
      }
    }
  }

  return { ops, shrunk: ops.length < inputOps.length, oracleCalls };
}

/**
 * Default oracle for crash/invariant bugs: replays the sequence on a fresh app
 * and reports whether any op threw or any invariant failed afterwards.
 */
export function makeReplayOracle(
  createApp: () => {
    runOp: (op: OpRecord) => Promise<{ kind: string }>;
    invariants: () => Array<string>;
  },
): Oracle {
  return async (candidateOps) => {
    const app = createApp();
    for (const op of candidateOps) {
      const result = await app.runOp(op);
      if (result.kind === 'error') {
        return { reproduces: true };
      }
      if (app.invariants().length > 0) {
        return { reproduces: true };
      }
    }
    if (app.invariants().length > 0) {
      return { reproduces: true };
    }
    return { reproduces: false };
  };
}
