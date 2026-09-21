import type { FuzzApp } from './app';
import { snapshotDocument } from './app';

/**
 * Tier-1 oracle: cheap structural checks run after EVERY op. A violation here
 * is a definite bug (no LLM needed to confirm).
 *
 * Each check returns a human-readable description of the violation or null.
 */
export function runInvariants(app: FuzzApp): Array<string> {
  const violations: Array<string> = [];

  const checks: Array<{ name: string; run: () => string | null }> = [
    { name: 'no-nan', run: () => checkNoNaN(app) },
    { name: 'selection-valid', run: () => checkSelectionValid(app) },
    { name: 'working-shapes-clear', run: () => checkWorkingShapesClear(app) },
    { name: 'serialization-healthy', run: () => checkSerializationHealthy(app) },
    { name: 'undo-redo-symmetry', run: () => checkUndoRedoSymmetry(app) },
  ];

  for (const check of checks) {
    let failure: string | null = null;
    try {
      failure = check.run();
    } catch (e) {
      failure = `invariant '${check.name}' threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (failure) {
      violations.push(`[${check.name}] ${failure}`);
    }
  }

  return violations;
}

function hasBadNumber(value: unknown, path: string): string | null {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) {
      return `NaN at ${path}`;
    }
    if (!Number.isFinite(value)) {
      return `${value} at ${path}`;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = hasBadNumber(value[i], `${path}[${i}]`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = hasBadNumber(child, `${path}.${key}`);
      if (found) {
        return found;
      }
    }
    return null;
  }
  return null;
}

function checkNoNaN(app: FuzzApp): string | null {
  // Serialize before walking the store so we catch any serialization-side NaN too.
  const snapshot = snapshotDocument(app);
  const found = hasBadNumber(snapshot, 'snapshot');
  if (found) {
    return `bad numeric value found in document state: ${found}`;
  }
  return null;
}

function checkSelectionValid(app: FuzzApp): string | null {
  const invalid = app.selectionManager
    .getSelectedIds()
    .filter((id) => !app.geometryStore.hasId(id));
  if (invalid.length > 0) {
    return `selection references missing geometries: ${invalid.join(', ')}`;
  }
  return null;
}

function checkWorkingShapesClear(app: FuzzApp): string | null {
  const bits: Array<string> = [];
  if (app.geometryStore.workingPolygon !== null) {
    bits.push('workingPolygon');
  }
  if (app.geometryStore.workingRectangle !== null) {
    bits.push('workingRectangle');
  }
  if (app.geometryStore.workingEllipse !== null) {
    bits.push('workingEllipse');
  }
  if (app.geometryStore.workingConstraints.length > 0) {
    bits.push('workingConstraints');
  }
  if (bits.length > 0) {
    return `leftover working state after op: ${bits.join(', ')}`;
  }
  return null;
}

function checkSerializationHealthy(app: FuzzApp): string | null {
  const svg = app.exportSvg();
  if (svg === null) {
    return 'SerializationManager.save() failed or returned no svg';
  }
  if (svg.includes('NaN') || svg.includes('Infinity')) {
    return 'serialized SVG contains NaN/Infinity';
  }
  return null;
}

function meaningfulBody(snapshot: ReturnType<typeof snapshotDocument>): unknown {
  const copy = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  delete copy.selectedIds;
  delete copy.history;
  return copy;
}

/**
 * Strong check: applying undo() then redo() must restore the exact same
 * document. This validates the undo entry symmetry of whatever op was just
 * performed. Skips safely when there is nothing to undo.
 */
function checkUndoRedoSymmetry(app: FuzzApp): string | null {
  if (!app.historyManager.canUndo()) {
    return null;
  }
  const before = meaningfulBody(snapshotDocument(app));

  app.historyManager.undo();
  const afterUndo = meaningfulBody(snapshotDocument(app));

  app.historyManager.redo();
  const afterRedo = meaningfulBody(snapshotDocument(app));

  const beforeJson = JSON.stringify(before);
  const afterJson = JSON.stringify(afterRedo);

  if (beforeJson !== afterJson) {
    return 'undo() then redo() did not restore identical document state';
  }

  if (JSON.stringify(afterUndo) === beforeJson) {
    return 'undo() did not change the document at all (no-op undo on non-empty stack)';
  }

  return null;
}
