import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  Constraint,
  ConstraintComponent,
  type ConstraintEndpoint,
  DatumComponent,
  Entity,
  FillColorComponent,
  GeometryComponent,
  type Id,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { ToolManager } from '@/lib/tools/ToolManager';
import {
  ScreenPosition,
  SheetPosition,
  ViewportPosition,
  type ViewportState,
} from '@/lib/viewport/types';
import { describeOp, executeOp } from './ops';
import { PRNG } from './prng';
import type { OpLogEntry, OpRecord, OpResult } from './types';

export { SHEET_UNITS_TO_PIXELS };

/** Builds a ViewportState with no pan/zoom and scale 1. */
export function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

/**
 * A headless, DOM-free instance of the whole cad2d core: Sheet, GeometryStore,
 * HistoryManager, SelectionManager, ToolManager, ActionsManager and
 * SerializationManager, all wired together exactly like the real app.
 */
export class FuzzApp {
  readonly seed: number;
  readonly rng: PRNG;
  readonly sheet: Sheet;
  readonly geometryStore;
  readonly historyManager;
  readonly selectionManager;
  readonly toolManager: ToolManager;
  readonly actionsManager: ActionsManager;
  readonly serializationManager: SerializationManager;
  readonly viewport: ViewportState;

  constructor(seed: number) {
    this.seed = seed;
    this.rng = new PRNG(seed);
    this.sheet = Sheet.a4();
    this.geometryStore = this.sheet.geometryStore;
    this.historyManager = this.sheet.historyManager;
    this.selectionManager = this.sheet.selectionManager;

    this.toolManager = new ToolManager(
      this.geometryStore,
      this.selectionManager,
      this.historyManager,
    );
    this.actionsManager = new ActionsManager(
      this.sheet,
      this.geometryStore,
      this.selectionManager,
      this.historyManager,
    );
    this.actionsManager.setToolManager(this.toolManager);
    this.serializationManager = new SerializationManager(
      this.actionsManager,
      this.toolManager,
      this.sheet,
    );
    this.actionsManager.setSerializationManager(this.serializationManager);
    this.toolManager.setSerializationManager(this.serializationManager);

    // Use an extremely fine grid so tool-driven drawing lands on exact coordinates.
    this.toolManager.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });

    // Deterministic ids: the real app uses random UUIDs, but reproducible replay
    // requires that replaying the same op sequence produces the exact same ids
    // (so ops that target a geometry by id bind to the right shape). Ids are
    // derived from a per-app counter, which advances identically on replay.
    let idCounter = 0;
    this.historyManager.generateStableId = (prefix?: string) => {
      idCounter += 1;
      return `${prefix ?? 'obj'}_fuzz${idCounter}`;
    };

    this.viewport = createViewportState(1);
  }

  /** Converts sheet coordinates to the screen coordinates the tools expect. */
  sheetToScreen(x: number, y: number): ScreenPosition {
    return new SheetPosition(x, y).toScreen(this.viewport);
  }

  /**
   * Runs a single concrete op. Catches any thrown exception and reports it as
   * an `error` result so the fuzzer can treat uncaught throws as bugs.
   */
  async runOp(op: OpRecord): Promise<OpResult> {
    try {
      const result = await executeOp(this, op);
      this.polishAfterOp();
      return result;
    } catch (e) {
      this.polishAfterOp();
      return {
        kind: 'error',
        message: e instanceof Error ? (e.stack ?? e.message) : String(e),
      };
    }
  }

  /**
   * Clears any in-progress working shapes without disturbing selection. Called
   * after every op so a partially-drawn shape never leaks into the next op.
   * Also prunes selected ids that no longer exist in the store - matching the
   * renderer, which can only ever select visible geometry.
   */
  polishAfterOp(): void {
    this.geometryStore.clearWorkingPolygon();
    this.geometryStore.clearWorkingRectangle();
    this.geometryStore.clearWorkingEllipse();
    this.geometryStore.clearWorkingConstraints();

    const stale = this.selectionManager
      .getSelectedIds()
      .filter((id) => !this.geometryStore.hasId(id));
    for (const id of stale) {
      this.selectionManager.deselect(id);
    }
  }

  /** Serializes the current document to SVG. */
  exportSvg(): string | null {
    const result = this.serializationManager.save();
    return result.success ? result.svg : null;
  }

  /** Human-readable log lines for a sequence of ops, for the LLM judge. */
  describeOps(ops: Array<OpRecord>): Array<OpLogEntry> {
    return ops.map((op, index) => ({ index, text: describeOp(op) }));
  }
}

/** A JSON-safe snapshot of the current document (used by invariants + judge). */
export function snapshotDocument(app: FuzzApp) {
  const geometries = Array.from(app.geometryStore.getAllGeometryIds())
    .map((id) => app.geometryStore.getById(id))
    .filter((g): g is Entity => g !== null)
    .map((g) => snapshotGeometry(g));

  const constraints = app.geometryStore.listWithComponent(ConstraintComponent).map((g) => {
    const typed = g as Entity<ConstraintComponent>;
    const data = ConstraintComponent.get(typed);
    const positionKeys = Constraint.getPositionKeys(typed);
    const endpoints: Record<string, unknown> = {};
    for (const key of positionKeys) {
      const ep = Constraint.getEndpoint(typed, key);
      if (ep) {
        endpoints[key] = constraintEndpointToJson(app, ep);
      }
    }
    let extra: Record<string, unknown> = {};
    if ('constrainedLength' in data && data.constrainedLength) {
      extra = {
        constrainedLength: data.constrainedLength.serialize(),
        axis: 'axis' in data && data.axis ? data.axis : undefined,
      };
    }
    return { id: g.id, type: data.type, ...endpoints, ...stripUndefined(extra) };
  });

  const datums = app.geometryStore
    .listWithComponent(DatumComponent)
    .map((g) => ({ id: g.id, position: DatumComponent.get(g as Entity<DatumComponent>) }));

  const filters = app.geometryStore
    .listWithComponent(FilterComponent)
    .map((g) => filterToJson(g as Entity<FilterComponent>));

  return {
    sheet: {
      width: app.sheet.width.serialize(),
      height: app.sheet.height.serialize(),
      defaultUnit: app.sheet.defaultUnit,
      unitPlaces: app.sheet.unitPlaces,
    },
    geometries,
    constraints,
    datums,
    filters,
    selectedIds: app.selectionManager.getSelectedIds(),
    history: {
      undoStackDepth: app.historyManager.getUndoStack().length,
      redoStackDepth: app.historyManager.getRedoStack().length,
    },
  };
}

function snapshotGeometry(g: Entity) {
  const base: Record<string, unknown> = { id: g.id };

  if (Entity.hasComponent(g, RenderOrderComponent)) {
    base.renderOrder = RenderOrderComponent.get(g);
  }
  if (Entity.hasComponent(g, FillColorComponent)) {
    base.fillColor = FillColorComponent.getOptional(g);
  }
  if (Entity.hasComponent(g, LinkDimensionsComponent)) {
    base.linkDimensions = LinkDimensionsComponent.get(g);
  }

  if (Entity.hasComponent(g, GeometryComponent)) {
    const data = GeometryComponent.get(g as Entity<GeometryComponent>);
    switch (data.type) {
      case 'polygon':
        base.type = 'polygon';
        base.closed = data.closed;
        base.openAtIndex = data.openAtIndex;
        base.points = data.points.map((seg) => ({ ...seg, point: seg.point }));
        break;
      case 'rectangle':
        base.type = 'rectangle';
        base.upperLeft = data.upperLeft;
        base.lowerRight = data.lowerRight;
        break;
      case 'ellipse':
        base.type = 'ellipse';
        base.center = data.center;
        base.radiusX = data.radiusX;
        base.radiusY = data.radiusY;
        break;
    }
  } else if (Entity.hasComponent(g, DatumComponent)) {
    base.type = 'datum';
    base.position = DatumComponent.get(g as Entity<DatumComponent>);
  } else if (Entity.hasComponent(g, ConstraintComponent)) {
    base.type = 'constraint';
  } else if (Entity.hasComponent(g, FilterComponent)) {
    base.type = 'filter';
  }

  return base;
}

function constraintEndpointToJson(app: FuzzApp, ep: ConstraintEndpoint) {
  const resolved = app.geometryStore.resolveConstraintEndpoint(ep);
  const asData: Record<string, unknown> = { type: ep.type };
  for (const [key, value] of Object.entries(ep)) {
    if (key !== 'type') {
      asData[key] = value;
    }
  }
  return { ...asData, resolvedPosition: resolved };
}

function filterToJson(g: Entity<FilterComponent>) {
  const data = FilterComponent.get(g);
  const base: Record<string, unknown> = { id: g.id, type: data.type };
  if ('geometryId' in data) {
    base.geometryId = data.geometryId;
  }
  if ('offset' in data && data.offset) {
    base.offset = data.offset.serialize();
  }
  if ('pointA' in data) {
    base.pointA = data.pointA;
  }
  if ('pointB' in data) {
    base.pointB = data.pointB;
  }
  if ('center' in data) {
    base.center = data.center;
  }
  return base;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== 'undefined') {
      out[key] = value;
    }
  }
  return out;
}

export type { Id };
