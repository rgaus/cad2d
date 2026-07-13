import { ActionsManager } from '@/lib/actions/ActionsManager';
import { ConstraintComponent, LinearConstraint, RectangleComponent } from '@/lib/geometry';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { WorkingLinearConstraint } from '@/lib/tools/types';
import { CentimetersLength, CentimetersType } from '@/lib/units/length';
import { GeometryStore } from '../lib/geometry/GeometryStore';
import { HistoryManager } from '../lib/history/HistoryManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '../lib/sheet/Sheet';
import { subscribeToEvents } from '../lib/subscribe-to-events';
import { RectangleTool } from '../lib/tools/RectangleTool';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { ToolManager } from '../lib/tools/ToolManager';
import { ScreenPosition, ViewportPosition, type ViewportState } from '../lib/viewport/types';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('RectangleTool', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;
  let toolManager: ToolManager;
  let rectangleTool: RectangleTool;
  let viewport: ViewportState;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    selectionManager = new SelectionManager();
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(
      new SerializationManager(actionsManager, toolManager, sheet),
    );
    rectangleTool = toolManager.getTool('rectangle') as RectangleTool;
    viewport = createViewportState(1);
    toolManager.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    toolManager.setActiveTool('rectangle');
  });

  describe('basic rectangle creation + completion', () => {
    it('first click creates working rectangle', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      const wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint).not.toBeNull();
      expect(wr!.previewLowerRight).toBeNull();
      expect(wr!.isCenterMode).toBe(false);
    });

    it('mouse move updates preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      const wr = geometryStore.workingRectangle;
      expect(wr!.previewLowerRight).not.toBeNull();
      expect(wr!.previewLowerRight!.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('second click completes rectangle', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);
      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(1);
      expect(geometryStore.workingRectangle).toBeNull();

      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('clicking same location twice should not create a zero-size rect', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(0);
    });
  });

  describe('corner mode bounds', () => {
    it('clicking lower-left then upper-right produces correct bounds', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('center mode', () => {
    it('alt on first click enters center mode', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      const wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.isCenterMode).toBe(true);
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('center mode upperLeft/lowerRight computed from center + radius', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      expect(geometryStore.workingRectangle!.isCenterMode).toBe(true);

      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);

      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      const dx = Math.abs(30 / SHEET_UNITS_TO_PIXELS - 10 / SHEET_UNITS_TO_PIXELS);
      const dy = Math.abs(20 / SHEET_UNITS_TO_PIXELS - 10 / SHEET_UNITS_TO_PIXELS);
      const upperLeftX = 10 / SHEET_UNITS_TO_PIXELS - dx;
      const upperLeftY = 10 / SHEET_UNITS_TO_PIXELS - dy;
      const lowerRightX = 10 / SHEET_UNITS_TO_PIXELS + dx;
      const lowerRightY = 10 / SHEET_UNITS_TO_PIXELS + dy;

      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(upperLeftX, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(upperLeftY, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(lowerRightX, 2);
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(lowerRightY, 2);
    });
  });

  describe('square constraint (shift)', () => {
    it('shift held forces square lower-right during preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(15, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const wr = geometryStore.workingRectangle;
      expect(wr!.previewLowerRight!.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it.skip('square constrained rect completes correctly', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(15, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(15, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(1);
      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('shift constrains correctly even when mouse moves to negative quadrant', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(5, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const wr = geometryStore.workingRectangle;
      expect(wr!.previewLowerRight!.x).toBeCloseTo(0 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('alt toggles center mode', () => {
    it('alt key toggles isCenterMode while drawing', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingRectangle!.isCenterMode).toBe(false);

      const events = subscribeToEvents(rectangleTool, ['isCenterModeChange']);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingRectangle!.isCenterMode).toBe(true);
      expect(events.areThereBufferedEvents('isCenterModeChange')).toBe(true);
    });

    it('alt key up re-evaluates center mode from toolManager', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingRectangle!.isCenterMode).toBe(true);

      toolManager.handleKeyUp({ key: 'Alt', altKey: false } as KeyboardEvent);
      expect(geometryStore.workingRectangle!.isCenterMode).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('escape aborts rectangle', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(geometryStore.workingRectangle).toBeNull();
      expect(rectangleTool.previewSheetPos).toBeNull();
    });

    it('enter completes with current preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(1);
      expect(geometryStore.workingRectangle).toBeNull();

      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('enter does nothing when no preview is set', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(0);
      expect(geometryStore.workingRectangle).not.toBeNull();
    });
  });

  describe('tool focus / blur', () => {
    it('blur clears working rectangle', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      rectangleTool.handleToolBlur();

      expect(geometryStore.workingRectangle).toBeNull();
    });

    it('blur clears previewSheetPos', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      expect(rectangleTool.previewSheetPos).not.toBeNull();

      rectangleTool.handleToolBlur();

      expect(rectangleTool.previewSheetPos).toBeNull();
    });

    it.skip('blur emits previewSheetPositionChange(null)', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      const events = subscribeToEvents(rectangleTool, ['previewSheetPositionChange']);
      rectangleTool.handleToolBlur();

      expect(events.areThereBufferedEvents('previewSheetPositionChange')).toBe(true);
    });
  });

  describe('working constraints', () => {
    it('should create working constraints when drawing a rectangle, and convert into actual constraints on completion', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Make sure working constraints are created
      expect(geometryStore.workingConstraints).toHaveLength(2);

      // Move cursor further out
      toolManager.handleMouseMove(new ScreenPosition(30, 40), viewport);

      // Make sure working constraints update:
      expect(geometryStore.workingConstraints).toHaveLength(2);
      // First working constraint is along the top
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      // Second working constraing is along the left side
      expect((geometryStore.workingConstraints[1].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointA as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.y).toBeCloseTo(
        40 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Update the top working constraint to be 100cm wide
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide
      const wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Click to create the rectangle
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the rectangle was added
      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(1);
      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS + 100,
        2,
      );
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Also make sure a constraint was added for the top
      const constraints = geometryStore.listWithComponent(ConstraintComponent);
      expect(constraints).toHaveLength(1);
      const constraint = ConstraintComponent.get(constraints[0]) as LinearConstraintData;
      expect(constraint.type).toStrictEqual('linear');
      expect(constraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(constraint.constrainedLength.magnitude).toStrictEqual(100);
      expect((constraint.pointA as any).type).toStrictEqual('locked-rectangle');
      expect((constraint.pointA as any).point).toStrictEqual('upperLeft');
      expect((constraint.pointA as any).id).toStrictEqual(rect.id);
      expect((constraint.pointB as any).type).toStrictEqual('locked-rectangle');
      expect((constraint.pointB as any).point).toStrictEqual('upperRight');
      expect((constraint.pointB as any).id).toStrictEqual(rect.id);
    });
    it('should be able to constrain both dimensions of a rectangle', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update the top working constraint to be 100cm, and left to be 50cm
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        { ...old[1], constrainedLength: new CentimetersLength(50) },
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm x 50cm
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 50, 2);

      // The user can move the cursor all they want...
      toolManager.handleMouseMove(new ScreenPosition(999, 555), viewport);

      // ... but the size still stays the same
      wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 50, 2);

      // Click to create the rectangle
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the rectangle was added
      expect(geometryStore.listWithComponent(RectangleComponent)).toHaveLength(1);
      const rect = geometryStore.listWithComponent(RectangleComponent)[0];
      expect(RectangleComponent.get(rect).upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).upperLeft.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(RectangleComponent.get(rect).lowerRight.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS + 100,
        2,
      );
      expect(RectangleComponent.get(rect).lowerRight.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS + 50,
        2,
      );

      // Also make sure both a top and left constraint were added
      const constraints = geometryStore.listWithComponent(ConstraintComponent);
      expect(constraints).toHaveLength(2);

      const topConstraint = ConstraintComponent.get(constraints[0]) as LinearConstraintData;
      expect(topConstraint.type).toStrictEqual('linear');
      expect(topConstraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(topConstraint.constrainedLength.magnitude).toStrictEqual(100);
      expect((topConstraint.pointA as any).type).toStrictEqual('locked-rectangle');
      expect((topConstraint.pointA as any).point).toStrictEqual('upperLeft');
      expect((topConstraint.pointA as any).id).toStrictEqual(rect.id);
      expect((topConstraint.pointB as any).type).toStrictEqual('locked-rectangle');
      expect((topConstraint.pointB as any).point).toStrictEqual('upperRight');
      expect((topConstraint.pointB as any).id).toStrictEqual(rect.id);

      const leftConstraint = ConstraintComponent.get(constraints[1]) as LinearConstraintData;
      expect(leftConstraint.type).toStrictEqual('linear');
      expect(leftConstraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(leftConstraint.constrainedLength.magnitude).toStrictEqual(50);
      expect((leftConstraint.pointA as any).type).toStrictEqual('locked-rectangle');
      expect((leftConstraint.pointA as any).point).toStrictEqual('upperLeft');
      expect((leftConstraint.pointA as any).id).toStrictEqual(rect.id);
      expect((leftConstraint.pointB as any).type).toStrictEqual('locked-rectangle');
      expect((leftConstraint.pointB as any).point).toStrictEqual('lowerLeft');
      expect((leftConstraint.pointB as any).id).toStrictEqual(rect.id);
    });
    it('should be able to constrain both sides of a rectangle and place it in any quadrant', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update both working constraints
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        { ...old[1], constrainedLength: new CentimetersLength(50) },
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(30, 40), viewport);

      // Make sure working rectangle is now 100x50
      let we = geometryStore.workingRectangle;
      expect(we).not.toBeNull();
      expect(we!.previewLowerRight!.x).toBeCloseTo(100, 1);
      expect(we!.previewLowerRight!.y).toBeCloseTo(50, 1);

      // Move the cursor to each quadrant, and make sure the rectangle wholly lies in each
      for (const [cursorX, cursorY] of [
        [50, 50],
        [50, -50],
        [-50, 50],
        [-50, -50],
      ]) {
        toolManager.handleMouseMove(new ScreenPosition(cursorX, cursorY), viewport);

        we = geometryStore.workingRectangle;
        expect(we).not.toBeNull();
        if (cursorX > 0) {
          expect(we!.previewLowerRight!.x).toBeGreaterThan(0);
        } else {
          expect(we!.previewLowerRight!.x).toBeLessThan(0);
        }
        if (cursorY > 0) {
          expect(we!.previewLowerRight!.y).toBeGreaterThan(0);
        } else {
          expect(we!.previewLowerRight!.y).toBeLessThan(0);
        }
      }
    });
    it('should be able to reset a cosntraint after setting it', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update the top working constraint to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Reset top working constraint to be unset
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: null },
        ...old.slice(1),
      ]);

      // Move the mouse again
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure wotking rectangle is back to being unconstrained
      wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(31 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);
    });
    it('should ensure the constraints are set around the center when alt is held', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Press and hold alt
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);

      // Update the top working constraint to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide, with the rectangle centered on the first point
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.isCenterMode).toStrictEqual(true);
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS + 50 /* half on each side of center */,
        2,
      );
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);
    });
    it('should ensure the width constraint applies to both dimensions when shift is held', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update the top working constraint to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide, and as high as the mouse dictates
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Press and hold shift
      toolManager.handleKeyDown({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the second working constraint is now disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(true);

      // Also make sure both dimensions are 100cm long
      wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 100, 2);

      // Release shift
      toolManager.handleKeyUp({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the working rectangle height is now back to matching the mouse position
      wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.previewLowerRight!.y).toBeCloseTo(42 / SHEET_UNITS_TO_PIXELS, 2);

      // And that both working constraints are no longer disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(false);
    });
    it('should ensure if a height constraint is set, THEN shift is pressed, the height constraint becomes the square side length', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update the left working constraint to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        old[0],
        { ...old[1], constrainedLength: new CentimetersLength(100) },
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm high, and as high as the mouse dictates
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(31 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 100, 2);

      // Press and hold shift
      toolManager.handleKeyDown({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the second working constraint is now disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(true);

      // Also make sure that the first working constraint now has the 100cm value entered before,
      // and the second was cleared
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(CentimetersType);
      expect(geometryStore.workingConstraints[1].type).toStrictEqual('linear');
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength,
      ).toStrictEqual(null);
    });
  });

  describe('ctrl disables snapping', () => {
    it('preview is not snapped to grid when ctrl is held', () => {
      toolManager.setSnappingOptions({ primaryGridSize: 10, secondaryGridSize: null });

      toolManager.handleKeyDown({ key: 'Control', ctrlKey: true } as KeyboardEvent);

      // Click at (4, 3) in sheet units — would snap to (0, 0) with grid=10
      toolManager.handleMouseDown(
        new ScreenPosition(4 * SHEET_UNITS_TO_PIXELS, 3 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      // Move to (15, 25) — would snap to (20, 30) with grid=10
      toolManager.handleMouseMove(
        new ScreenPosition(15 * SHEET_UNITS_TO_PIXELS, 25 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      toolManager.handleKeyUp({ key: 'Control', ctrlKey: true } as KeyboardEvent);

      const wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();

      // Should NOT be snapped when ctrl is held
      expect(wr!.firstPoint!.x).toBeCloseTo(4, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(3, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo(15, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(25, 2);
    });
  });
});
