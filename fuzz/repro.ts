import * as fs from 'node:fs';
import * as path from 'node:path';
import { FuzzApp, snapshotDocument } from './app';
import { readOpsFile } from './corpus';
import { runInvariants } from './invariants';
import { describeOp } from './ops';
import type { OpRecord } from './types';

export type ReproResult = {
  caseDir: string;
  reproduced: boolean;
  opCount: number;
  error: string | null;
  invariantViolations: Array<string>;
  svg: string | null;
};

/**
 * Replays a bug artifact's `ops.json` against a fresh app and checks whether
 * the bug reproduces (an op throws, or an invariant fails afterward). This is
 * the programmatic check for the reproduction script.
 */
export async function reproduceFromOps(ops: Array<OpRecord>): Promise<ReproResult> {
  const app = new FuzzApp(Math.floor(Math.random() * 1e9));

  let error: string | null = null;
  const invariantViolations: Array<string> = [];

  for (const op of ops) {
    const result = await app.runOp(op);
    if (result.kind === 'error') {
      error = result.message;
      break;
    }
    const violations = runInvariants(app);
    if (violations.length > 0) {
      invariantViolations.push(...violations);
      break;
    }
  }

  if (!error && invariantViolations.length === 0) {
    const violations = runInvariants(app);
    invariantViolations.push(...violations);
  }

  const reproduced = error !== null || invariantViolations.length > 0;

  return {
    caseDir: '',
    reproduced,
    opCount: ops.length,
    error,
    invariantViolations,
    svg: app.exportSvg(),
  };
}

/** Replays a bug artifact directory and reports whether the bug reproduces. */
export async function reproduceCase(caseDir: string): Promise<ReproResult> {
  const opsPath = path.join(caseDir, 'ops.json');
  const raw = readOpsFile(opsPath);
  if (!raw) {
    throw new Error(`repro: no valid ops.json in ${caseDir}`);
  }

  const ops = raw as Array<OpRecord>;
  const result = await reproduceFromOps(ops);
  result.caseDir = caseDir;

  // Surface the expected symptom if a report exists.
  const metaPath = path.join(caseDir, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    result.caseDir = meta.caseId ?? caseDir;
  } catch {
    // ignore missing meta
  }

  return result;
}

/** Prints the reproduction and returns an exit code (1 when the bug reproduces). */
export function formatReproResult(result: ReproResult): number {
  const lines: Array<string> = [];
  lines.push(`Case dir: ${result.caseDir}`);
  lines.push(`Ops: ${result.opCount}`);
  if (result.error) {
    lines.push('REPRODUCED (crash):');
    lines.push(result.error);
  }
  if (result.invariantViolations.length > 0) {
    lines.push('REPRODUCED (invariant):');
    for (const violation of result.invariantViolations) {
      lines.push(`  ${violation}`);
    }
  }
  if (!result.error && result.invariantViolations.length === 0) {
    lines.push('NOT REPRODUCED - the minimized sequence no longer triggers the bug.');
  }
  console.log(lines.join('\n'));

  if (result.error || result.invariantViolations.length > 0) {
    return 1;
  }
  return 0;
}

export { snapshotDocument, describeOp };
