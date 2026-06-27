import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  Ellipse,
  LinearConstraint,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { ConstraintTool } from '@/lib/tools/ConstraintTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { WorkingLinearConstraint } from '@/lib/tools/types';
import { Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';

function makeRectangle(overrides: {
  id: string;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Rectangle {
  const template = Rectangle.create(overrides.upperLeft, overrides.lowerRight, {
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeEllipse(overrides: {
  id: string;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Ellipse {
  const template = Ellipse.create(overrides.center, {
    radiusX: overrides.radiusX,
    radiusY: overrides.radiusY,
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

describe('ConstraintTool key point snapping', () => {
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let constraintTool: ConstraintTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    constraintTool = toolManager.getTool('constraint') as ConstraintTool;
    toolManager.setActiveTool('constraint');
    toolManager.changeToolSubTool('constraint', 'linear-constraint');

    const sheet = Sheet.a4();
    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
  });

  it('snaps preview position to rectangle corner and sets isSnappedToKeyPoint', () => {
    geometryStore.addDirect(
      makeRectangle({
        id: 'rect-snap',
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: null,
        linkDimensions: true,
        renderOrder: 0,
      }),
    );

    let emittedEvent: unknown = null;
    constraintTool.on('previewSheetPositionChange', (data) => {
      emittedEvent = data;
    });

    const vpState = viewportControls.getState().viewport;

    // Move mouse over the rectangle's upperLeft corner (0, 0) in sheet space
    // Screen position maps to sheet position via viewport transform
    const worldX = 0;
    const worldY = 0;
    const screenPos = new ScreenPosition(
      worldX * vpState.scale + vpState.position.x,
      worldY * vpState.scale + vpState.position.y,
    );

    constraintTool.handleMouseMove(screenPos, vpState);

    expect(emittedEvent).not.toBeNull();
    const event = emittedEvent as { position: SheetPosition; isSnappedToKeyPoint: boolean };
    expect(event.isSnappedToKeyPoint).toBe(true);
    expect(event.position.x).toBe(0);
    expect(event.position.y).toBe(0);
  });

  it('sets isSnappedToKeyPoint false when not near a key point', () => {
    geometryStore.addDirect(
      makeRectangle({
        id: 'rect-nosnap',
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: null,
        linkDimensions: true,
        renderOrder: 0,
      }),
    );

    let emittedEvent: unknown = null;
    constraintTool.on('previewSheetPositionChange', (data) => {
      emittedEvent = data;
    });

    const vpState = viewportControls.getState().viewport;

    // Move mouse far from any key point
    const worldX = 50 * SHEET_UNITS_TO_PIXELS;
    const worldY = 50 * SHEET_UNITS_TO_PIXELS;
    const screenPos = new ScreenPosition(
      worldX * vpState.scale + vpState.position.x,
      worldY * vpState.scale + vpState.position.y,
    );

    constraintTool.handleMouseMove(screenPos, vpState);

    expect(emittedEvent).not.toBeNull();
    const event = emittedEvent as { position: SheetPosition; isSnappedToKeyPoint: boolean };
    expect(event.isSnappedToKeyPoint).toBe(false);
  });

  it('creates locked-rectangle pointA when first click is on a rectangle corner', () => {
    const rectId = 'rect-first';
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: null,
        linkDimensions: true,
        renderOrder: 0,
      }),
    );

    const vpState = viewportControls.getState().viewport;

    // Click at the rectangle's upperLeft corner
    const worldX = 0;
    const worldY = 0;
    const screenPos = new ScreenPosition(
      worldX * vpState.scale + vpState.position.x,
      worldY * vpState.scale + vpState.position.y,
    );

    constraintTool.handleMouseDown(screenPos, vpState);

    expect(geometryStore.workingConstraints.length).toBe(1);
    const wc = geometryStore.workingConstraints[0];
    expect(wc.pointA).toEqual({
      type: 'locked-rectangle',
      id: rectId,
      point: 'upperLeft',
    });
    expect(wc.pointB).toEqual({
      type: 'locked-rectangle',
      id: rectId,
      point: 'upperLeft',
    });
  });

  it('snaps pointB to a key point during mouse move after first click', () => {
    const ellipseId = 'ellipse-snap';
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(5, 5),
        radiusX: 3,
        radiusY: 2,
        fillColor: null,
        linkDimensions: true,
        renderOrder: 0,
      }),
    );

    const vpState = viewportControls.getState().viewport;

    // First click somewhere far to create the working constraint
    {
      const worldX = 0;
      const worldY = 50 * SHEET_UNITS_TO_PIXELS;
      const screenPos = new ScreenPosition(
        worldX * vpState.scale + vpState.position.x,
        worldY * vpState.scale + vpState.position.y,
      );
      constraintTool.handleMouseDown(screenPos, vpState);
    }

    // Move mouse over the ellipse center (5, 5) in sheet space
    {
      const worldX = 5 * SHEET_UNITS_TO_PIXELS;
      const worldY = 5 * SHEET_UNITS_TO_PIXELS;
      const screenPos = new ScreenPosition(
        worldX * vpState.scale + vpState.position.x,
        worldY * vpState.scale + vpState.position.y,
      );
      constraintTool.handleMouseMove(screenPos, vpState);
    }

    const wc = geometryStore.workingConstraints[0];
    expect(wc.pointB).toEqual({
      type: 'locked-ellipse',
      id: ellipseId,
      point: 'center',
    });
  });

  it('does not snap when shift is held', () => {
    geometryStore.addDirect(
      makeRectangle({
        id: 'rect-shift',
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: null,
        linkDimensions: true,
        renderOrder: 0,
      }),
    );

    toolManager.handleKeyDown({ key: 'Shift', shiftKey: true } as KeyboardEvent);

    const vpState = viewportControls.getState().viewport;

    const worldX = 0;
    const worldY = 0;
    const screenPos = new ScreenPosition(
      worldX * vpState.scale + vpState.position.x,
      worldY * vpState.scale + vpState.position.y,
    );

    constraintTool.handleMouseDown(screenPos, vpState);

    toolManager.handleKeyUp({ key: 'Shift', shiftKey: true } as KeyboardEvent);

    expect(geometryStore.workingConstraints.length).toBe(1);
    const wc = geometryStore.workingConstraints[0];
    expect(wc.pointA.type).toBe('point');
  });

  it('emits null previewSheetPositionChange on abort', () => {
    const vpState = viewportControls.getState().viewport;

    // Start a working constraint
    {
      const worldX = 0;
      const worldY = 50 * SHEET_UNITS_TO_PIXELS;
      const screenPos = new ScreenPosition(
        worldX * vpState.scale + vpState.position.x,
        worldY * vpState.scale + vpState.position.y,
      );
      constraintTool.handleMouseDown(screenPos, vpState);
    }

    let emittedEvent: unknown = 'not-null';
    constraintTool.on('previewSheetPositionChange', (data) => {
      emittedEvent = data;
    });

    // Abort via Escape
    constraintTool.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

    expect(emittedEvent).toBeNull();
    expect(geometryStore.workingConstraints.length).toBe(0);
  });
});

describe('LinearXConstraintTool and LinearYConstraintTool', () => {
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let constraintTool: ConstraintTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    constraintTool = toolManager.getTool('constraint') as ConstraintTool;
    toolManager.setActiveTool('constraint');

    const sheet = Sheet.a4();
    toolManager.setSerializationManager(
      new SerializationManager({} as ActionsManager, toolManager, sheet),
    );
    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
  });

  it('creates a datum when a second constraint snaps to the first constraint free endpoint', () => {
    const vpState = viewportControls.getState().viewport;

    // Create first constraint: free point A (4, 5) to free point B (8, 5)
    constraintTool.handleMouseDown(new SheetPosition(4, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(8, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(8, 5).toScreen(vpState), vpState);
    expect(geometryStore.constraints).toHaveLength(1);
    const c1 = geometryStore.constraints[0];
    expect((c1 as LinearConstraint).pointB.type).toBe('point');

    // Start creating second constraint: free point C (6, 3)
    constraintTool.handleMouseDown(new SheetPosition(6, 3).toScreen(vpState), vpState);
    // Mouse move to point B (8, 5) — the first constraint's free endpoint
    constraintTool.handleMouseMove(new SheetPosition(8, 5).toScreen(vpState), vpState);
    // Click to commit — should create a datum at (8, 5)
    constraintTool.handleMouseDown(new SheetPosition(8, 5).toScreen(vpState), vpState);

    // Verify second constraint was created
    expect(geometryStore.constraints).toHaveLength(2);

    // A datum should have been auto-created
    const datums = geometryStore.listWithComponent(DatumComponent);
    expect(datums).toHaveLength(1);
    const datum = datums[0];
    expect(DatumComponent.get(datum)).toEqual(new SheetPosition(8, 5));

    // Both constraints should now be locked to the datum
    const c1After = geometryStore.constraints[0] as LinearConstraint;
    const c2After = geometryStore.constraints[1] as LinearConstraint;

    expect(c1After.pointB.type).toStrictEqual('locked-datum');
    if (c1After.pointB.type === 'locked-datum') {
      expect(c1After.pointB.id).toStrictEqual(datum.id);
    }
    expect(c2After.pointB.type).toStrictEqual('locked-datum');
    if (c2After.pointB.type === 'locked-datum') {
      expect(c2After.pointB.id).toStrictEqual(datum.id);
    }
  });

  it('deletes attached constraints when the datum is deleted', () => {
    const vpState = viewportControls.getState().viewport;

    // Create rectangle A and B
    const rectA = geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(2, 2)),
    );
    const rectB = geometryStore.add(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 10), new SheetPosition(12, 12)),
    );

    // C1 from rectA.upperLeft to free point (6, 6)
    constraintTool.handleMouseDown(new SheetPosition(0, 0).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(6, 6).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(6, 6).toScreen(vpState), vpState);

    // C2 from rectB.upperLeft to free point (6, 6) — should create a datum
    constraintTool.handleMouseDown(new SheetPosition(10, 10).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(6, 6).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(6, 6).toScreen(vpState), vpState);

    // Both constraints should exist with proper types
    expect(geometryStore.constraints).toHaveLength(2);
    expect(geometryStore.constraints[0].type).toBe('linear');
    expect(geometryStore.constraints[1].type).toBe('linear');

    // A datum should exist
    const datumsBefore = geometryStore.listWithComponent(DatumComponent);
    expect(datumsBefore).toHaveLength(1);

    // Delete everything
    geometryStore.deleteById(rectA.id);
    geometryStore.deleteById(rectB.id);
    geometryStore.deleteById(datumsBefore[0].id);

    // Constraints attached to the deleted datum are also deleted
    expect(geometryStore.constraints).toHaveLength(0);
  });

  it('deletes constraints when the datum they are attached to is deleted', () => {
    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(3, 3)));
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToDatum(datum.id),
        ConstraintEndpoint.point(new SheetPosition(8, 3)),
        Length.centimeters(5),
      ),
    );
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToDatum(datum.id),
        ConstraintEndpoint.point(new SheetPosition(3, 8)),
        Length.centimeters(5),
      ),
    );

    expect(geometryStore.constraints).toHaveLength(2);

    geometryStore.deleteById(datum.id);

    // Both constraints should be deleted along with the datum
    expect(geometryStore.constraints).toHaveLength(0);
  });

  it('does not create an orphaned datum when constraint creation is aborted via Escape', () => {
    const vpState = viewportControls.getState().viewport;

    // C1 with free pointB at (8, 5)
    constraintTool.handleMouseDown(new SheetPosition(4, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(8, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(8, 5).toScreen(vpState), vpState);
    expect(geometryStore.constraints).toHaveLength(1);

    // Start C2: first click at (6, 3), then mouse move to (8, 5) — should detect shouldCreateDatum
    constraintTool.handleMouseDown(new SheetPosition(6, 3).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(8, 5).toScreen(vpState), vpState);

    // Abort via Escape
    constraintTool.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

    // No datum should have been created, and C1's pointB should still be a free point
    expect(geometryStore.listWithComponent(DatumComponent)).toHaveLength(0);
    expect((geometryStore.constraints[0] as LinearConstraint).pointB.type).toBe('point');
    expect(geometryStore.workingConstraints).toHaveLength(0);
  });

  it('locks to an existing datum on first click', () => {
    const vpState = viewportControls.getState().viewport;

    const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(new SheetPosition(3, 3)));

    // First click near the datum
    constraintTool.handleMouseDown(new SheetPosition(3, 3).toScreen(vpState), vpState);

    const wc = geometryStore.workingConstraints[0] as WorkingLinearConstraint;
    expect(wc.pointA.type).toStrictEqual('locked-datum');
    if (wc.pointA.type === 'locked-datum') {
      expect(wc.pointA.id).toStrictEqual(datum.id);
    }
    expect(wc.pointB.type).toStrictEqual('locked-datum');
    if (wc.pointB.type === 'locked-datum') {
      expect(wc.pointB.id).toStrictEqual(datum.id);
    }
  });

  it('consolidates multiple constraint free endpoints into one datum on snap', () => {
    const vpState = viewportControls.getState().viewport;

    // C1: pointA=free(2,5), pointB=free(5,5)
    constraintTool.handleMouseDown(new SheetPosition(2, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(5, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);

    // C2: pointA=free(5,5), pointB=free(8,5)
    constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(8, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(8, 5).toScreen(vpState), vpState);

    // C3: pointA=free(3,5), pointB snaps to (5,5) — should create one datum
    constraintTool.handleMouseDown(new SheetPosition(3, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseMove(new SheetPosition(5, 5).toScreen(vpState), vpState);
    constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);

    // One datum should exist
    const datums = geometryStore.listWithComponent(DatumComponent);
    expect(datums).toHaveLength(1);
    const datumId = datums[0].id;

    // All three constraints should have their endpoints consolidated to the datum
    for (const c of geometryStore.constraints) {
      const linear = c as LinearConstraint;
      if (
        linear.pointB.type === 'point' &&
        linear.pointB.point.x === 5 &&
        linear.pointB.point.y === 5
      ) {
        throw new Error(
          `Constraint ${c.id} still has a free endpoint at (5,5) — should have been consolidated to locked-datum`,
        );
      }
      // C1.pointB was at (5,5) initially, should now be locked-datum
      if (c.id === geometryStore.constraints[0].id) {
        expect(linear.pointB.type).toStrictEqual('locked-datum');
        if (linear.pointB.type === 'locked-datum') {
          expect(linear.pointB.id).toStrictEqual(datumId);
        }
      }
      // C2.pointA was at (5,5) initially, should now be locked-datum
      if (c.id === geometryStore.constraints[1].id) {
        expect(linear.pointA.type).toStrictEqual('locked-datum');
        if (linear.pointA.type === 'locked-datum') {
          expect(linear.pointA.id).toStrictEqual(datumId);
        }
      }
      // C3.pointB snapped to (5,5), should be locked-datum
      if (c.id === geometryStore.constraints[2].id) {
        expect(linear.pointB.type).toStrictEqual('locked-datum');
        if (linear.pointB.type === 'locked-datum') {
          expect(linear.pointB.id).toStrictEqual(datumId);
        }
      }
    }
  });

  describe('PerpendicularConstraintTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'perpendicular-constraint');
    });

    it('creates a datum when pointA of a perpendicular constraint snaps to a linear constraint free endpoint', () => {
      const vpState = viewportControls.getState().viewport;

      // Switch to linear tool to create C1
      toolManager.changeToolSubTool('constraint', 'linear-constraint');
      constraintTool.handleMouseDown(new SheetPosition(2, 5).toScreen(vpState), vpState);
      constraintTool.handleMouseMove(new SheetPosition(5, 5).toScreen(vpState), vpState);
      constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);
      expect(geometryStore.constraints).toHaveLength(1);

      // Switch to perpendicular tool for C2
      toolManager.changeToolSubTool('constraint', 'perpendicular-constraint');

      // Click 1: center at (3, 3) (not near any constraint endpoint)
      constraintTool.handleMouseDown(new SheetPosition(3, 3).toScreen(vpState), vpState);
      // Mouse move to set pointA preview near (5, 5)
      constraintTool.handleMouseMove(new SheetPosition(5, 5).toScreen(vpState), vpState);
      // Click 2: pointA at (5, 5) — should snap to C1.pointB
      constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);
      // Mouse move to set pointB preview
      constraintTool.handleMouseMove(new SheetPosition(7, 3).toScreen(vpState), vpState);
      // Click 3: pointB at (7, 3) — completes constraint
      constraintTool.handleMouseDown(new SheetPosition(7, 3).toScreen(vpState), vpState);

      expect(geometryStore.constraints).toHaveLength(2);

      // A datum should have been created at (5, 5)
      const datums = geometryStore.listWithComponent(DatumComponent);
      expect(datums).toHaveLength(1);
      const datumId = datums[0].id;

      // C1.pointB should be locked-datum
      const c1 = geometryStore.constraints[0] as LinearConstraint;
      expect(c1.pointB.type).toStrictEqual('locked-datum');
      if (c1.pointB.type === 'locked-datum') {
        expect(c1.pointB.id).toStrictEqual(datumId);
      }

      // C2 (perpendicular): pointA should be locked-datum
      const c2 = geometryStore.constraints[1] as any;
      expect(c2.pointA.type).toStrictEqual('locked-datum');
      if (c2.pointA.type === 'locked-datum') {
        expect(c2.pointA.id).toStrictEqual(datumId);
      }
    });
  });

  describe('ParallelConstraintTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'parallel-constraint');
    });

    it('creates a datum when a parallel constraint point snaps to a linear constraint free endpoint', () => {
      const vpState = viewportControls.getState().viewport;

      // Switch to linear tool to create C1
      toolManager.changeToolSubTool('constraint', 'linear-constraint');
      constraintTool.handleMouseDown(new SheetPosition(2, 6).toScreen(vpState), vpState);
      constraintTool.handleMouseMove(new SheetPosition(5, 6).toScreen(vpState), vpState);
      constraintTool.handleMouseDown(new SheetPosition(5, 6).toScreen(vpState), vpState);
      expect(geometryStore.constraints).toHaveLength(1);

      // Switch to parallel tool
      toolManager.changeToolSubTool('constraint', 'parallel-constraint');

      // Click 1: pointA at (1, 2) (not near any constraint endpoint)
      constraintTool.handleMouseDown(new SheetPosition(1, 2).toScreen(vpState), vpState);
      // Mouse move + click 2: pointB at (5, 6) — should snap to C1.pointB
      constraintTool.handleMouseMove(new SheetPosition(5, 6).toScreen(vpState), vpState);
      constraintTool.handleMouseDown(new SheetPosition(5, 6).toScreen(vpState), vpState);
      // Mouse move + click 3: pointC at (2, 8)
      constraintTool.handleMouseMove(new SheetPosition(2, 8).toScreen(vpState), vpState);
      constraintTool.handleMouseDown(new SheetPosition(2, 8).toScreen(vpState), vpState);
      // Mouse move + click 4: pointD at (6, 8)
      constraintTool.handleMouseMove(new SheetPosition(6, 8).toScreen(vpState), vpState);
      constraintTool.handleMouseDown(new SheetPosition(6, 8).toScreen(vpState), vpState);

      expect(geometryStore.constraints).toHaveLength(2);

      // A datum should have been created at (5, 6)
      const datums = geometryStore.listWithComponent(DatumComponent);
      expect(datums).toHaveLength(1);
      const datumId = datums[0].id;

      // C1.pointB should be locked-datum
      const c1 = geometryStore.constraints[0] as LinearConstraint;
      expect(c1.pointB.type).toStrictEqual('locked-datum');
      if (c1.pointB.type === 'locked-datum') {
        expect(c1.pointB.id).toStrictEqual(datumId);
      }

      // C2 (parallel): pointB should be locked-datum
      const c2 = geometryStore.constraints[1] as any;
      expect(c2.pointB.type).toStrictEqual('locked-datum');
      if (c2.pointB.type === 'locked-datum') {
        expect(c2.pointB.id).toStrictEqual(datumId);
      }
    });
  });

  describe('LinearXConstraintTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'linear-x-constraint');
    });

    it('creates constraint with axis: x and x-distance length', () => {
      const vpState = viewportControls.getState().viewport;

      // Click 1 at (0, 2) — pointA
      constraintTool.handleMouseDown(new SheetPosition(0, 2).toScreen(vpState), vpState);
      // Mouse move to (5, 7) — updates pointB preview (diagonal with x-distance=5)
      constraintTool.handleMouseMove(new SheetPosition(5, 7).toScreen(vpState), vpState);
      // Click 2 at (5, 7) — pointB, completes constraint
      constraintTool.handleMouseDown(new SheetPosition(5, 7).toScreen(vpState), vpState);

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].type).toStrictEqual('linear');
      expect((geometryStore.constraints[0] as LinearConstraint).axis).toBe('x');
      // x-distance (5) should be used, not the diagonal (≈7.07)
      expect(
        (geometryStore.constraints[0] as LinearConstraint).constrainedLength.toSheetUnits('cm')
          .magnitude,
      ).toBeCloseTo(5, 5);
    });

    it('working constraint preview has axis: x', () => {
      const vpState = viewportControls.getState().viewport;

      // Click 1 only — working constraint should be created
      constraintTool.handleMouseDown(
        new SheetPosition(0, 2).toScreen(viewportControls.getState().viewport),
        vpState,
      );

      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toBe('linear');
      expect((geometryStore.workingConstraints[0] as WorkingLinearConstraint).axis).toBe('x');
    });
  });

  describe('LinearYConstraintTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'linear-y-constraint');
    });

    it('creates constraint with axis: y and y-distance length', () => {
      const vpState = viewportControls.getState().viewport;

      // Click 1 at (2, 0)
      constraintTool.handleMouseDown(new SheetPosition(2, 0).toScreen(vpState), vpState);
      // Mouse move to (7, 6) — updates pointB preview (diagonal with y-distance=6)
      constraintTool.handleMouseMove(new SheetPosition(7, 6).toScreen(vpState), vpState);
      // Click 2 at (7, 6)
      constraintTool.handleMouseDown(new SheetPosition(7, 6).toScreen(vpState), vpState);

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].type).toStrictEqual('linear');
      expect((geometryStore.constraints[0] as LinearConstraint).axis).toBe('y');
      // y-distance (6) should be used, not the diagonal (≈7.81)
      expect(
        (geometryStore.constraints[0] as LinearConstraint).constrainedLength.toSheetUnits('cm')
          .magnitude,
      ).toBeCloseTo(6, 5);
    });

    it('working constraint preview has axis: y', () => {
      const vpState = viewportControls.getState().viewport;

      constraintTool.handleMouseDown(
        new SheetPosition(2, 0).toScreen(viewportControls.getState().viewport),
        vpState,
      );

      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toBe('linear');
      expect((geometryStore.workingConstraints[0] as WorkingLinearConstraint).axis).toBe('y');
    });
  });

  describe('DatumTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'datum');
    });

    it('places a datum on click with snapping applied', () => {
      const vpState = viewportControls.getState().viewport;
      constraintTool.handleMouseDown(new SheetPosition(5, 5).toScreen(vpState), vpState);

      const datums = geometryStore.listWithComponent(DatumComponent);
      expect(datums).toHaveLength(1);
      expect(DatumComponent.get(datums[0])).toEqual(new SheetPosition(5, 5));
    });
  });
});
