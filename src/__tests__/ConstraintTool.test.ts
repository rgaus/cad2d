import { ActionsManager } from '@/lib/actions/ActionsManager';
import { Ellipse, LinearConstraint, Rectangle, RenderOrderComponent } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { ConstraintTool } from '@/lib/tools/ConstraintTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { WorkingLinearConstraint } from '@/lib/tools/types';
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

  describe('LinearXConstraintTool', () => {
    beforeEach(() => {
      toolManager.changeToolSubTool('constraint', 'linear-x-constraint');
    });

    it('creates constraint with axis: x and x-distance length', () => {
      const vpState = viewportControls.getState().viewport;

      // Click 1 at (0, 2) — pointA
      constraintTool.handleMouseDown(new SheetPosition(0, 2).toScreen(viewportControls.getState().viewport), vpState);
      // Mouse move to (5, 2) — updates pointB preview (horizontal line)
      constraintTool.handleMouseMove(new SheetPosition(5, 2).toScreen(viewportControls.getState().viewport), vpState);
      // Click 2 at (5, 2) — pointB, completes constraint
      constraintTool.handleMouseDown(new SheetPosition(5, 2).toScreen(viewportControls.getState().viewport), vpState);

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].type).toStrictEqual('linear');
      expect((geometryStore.constraints[0] as LinearConstraint).axis).toBe('x');
      expect(
        (geometryStore.constraints[0] as LinearConstraint).constrainedLength.toSheetUnits('cm').magnitude,
      ).toBeCloseTo(5, 5);
    });

    it('working constraint preview has axis: x', () => {
      const vpState = viewportControls.getState().viewport;

      // Click 1 only — working constraint should be created
      constraintTool.handleMouseDown(new SheetPosition(0, 2).toScreen(viewportControls.getState().viewport), vpState);

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
      constraintTool.handleMouseDown(new SheetPosition(2, 0).toScreen(viewportControls.getState().viewport), vpState);
      // Mouse move to (2, 6) — updates pointB preview (vertical line)
      constraintTool.handleMouseMove(new SheetPosition(2, 6).toScreen(viewportControls.getState().viewport), vpState);
      // Click 2 at (2, 6)
      constraintTool.handleMouseDown(new SheetPosition(2, 6).toScreen(viewportControls.getState().viewport), vpState);

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].type).toStrictEqual('linear');
      expect((geometryStore.constraints[0] as LinearConstraint).axis).toBe('y');
      expect(
        (geometryStore.constraints[0] as LinearConstraint).constrainedLength.toSheetUnits('cm').magnitude,
      ).toBeCloseTo(6, 5);
    });

    it('working constraint preview has axis: y', () => {
      const vpState = viewportControls.getState().viewport;

      constraintTool.handleMouseDown(new SheetPosition(2, 0).toScreen(viewportControls.getState().viewport), vpState);

      expect(geometryStore.workingConstraints).toHaveLength(1);
      expect(geometryStore.workingConstraints[0].type).toBe('linear');
      expect((geometryStore.workingConstraints[0] as WorkingLinearConstraint).axis).toBe('y');
    });
  });
});
