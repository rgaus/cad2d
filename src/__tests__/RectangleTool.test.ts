import { RectangleTool } from '../lib/tools/RectangleTool';
import { ToolManager } from '../lib/tools/ToolManager';
import { GeometryStore } from '../lib/tools/GeometryStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { ViewportPosition, ScreenPosition, type ViewportState } from '../lib/viewport/types';
import { Sheet, SHEET_UNITS_TO_PIXELS, Sheets } from '../lib/sheet/Sheet';
import { subscribeToEvents } from '../lib/subscribe-to-events';
import { CentimetersLength, CentimetersType } from '@/lib/units/length';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { ActionsManager } from '@/lib/actions/ActionsManager';

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
    sheet = Sheets.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    selectionManager = new SelectionManager();
    actionsManager = new ActionsManager(geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(new SerializationManager(actionsManager, toolManager, () => sheet));
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
      expect(geometryStore.rectangles).toHaveLength(1);
      expect(geometryStore.workingRectangle).toBeNull();

      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('clicking same location twice should not create a zero-size rect', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.rectangles).toHaveLength(0);
    });
  });

  describe('corner mode bounds', () => {
    it('clicking lower-left then upper-right produces correct bounds', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
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

      const rect = geometryStore.rectangles[0];
      const dx = Math.abs(30 / SHEET_UNITS_TO_PIXELS - 10 / SHEET_UNITS_TO_PIXELS);
      const dy = Math.abs(20 / SHEET_UNITS_TO_PIXELS - 10 / SHEET_UNITS_TO_PIXELS);
      const upperLeftX = 10 / SHEET_UNITS_TO_PIXELS - dx;
      const upperLeftY = 10 / SHEET_UNITS_TO_PIXELS - dy;
      const lowerRightX = 10 / SHEET_UNITS_TO_PIXELS + dx;
      const lowerRightY = 10 / SHEET_UNITS_TO_PIXELS + dy;

      expect(rect.upperLeft.x).toBeCloseTo(upperLeftX, 2);
      expect(rect.upperLeft.y).toBeCloseTo(upperLeftY, 2);
      expect(rect.lowerRight.x).toBeCloseTo(lowerRightX, 2);
      expect(rect.lowerRight.y).toBeCloseTo(lowerRightY, 2);
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

      expect(geometryStore.rectangles).toHaveLength(1);
      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
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

      expect(geometryStore.rectangles).toHaveLength(1);
      expect(geometryStore.workingRectangle).toBeNull();

      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('enter does nothing when no preview is set', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.rectangles).toHaveLength(0);
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
      expect(geometryStore.workingConstraints[0].pointA.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[0].pointA.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[0].pointB.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[0].pointB.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      // Second working constraing is along the left side
      expect(geometryStore.workingConstraints[1].pointA.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[1].pointA.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[1].pointB.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(geometryStore.workingConstraints[1].pointB.y).toBeCloseTo(40 / SHEET_UNITS_TO_PIXELS, 2);

      // Update the top working constraint to be 100cm wide
      geometryStore.setWorkingConstraints((old) => [{ ...old[0], constrainedLength: new CentimetersLength(100) }, ...old.slice(1)]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide
      const wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Click to create the rectangle
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the rectangle was added
      expect(geometryStore.rectangles).toHaveLength(1);
      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(rect.lowerRight.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Also make sure a constraint was added for the top
      expect(geometryStore.constraints).toHaveLength(1);
      const constraint = geometryStore.constraints[0];
      expect(constraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(constraint.constrainedLength.magnitude).toStrictEqual(100);
      expect(constraint.pointA.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(constraint.pointA.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(constraint.pointB.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(constraint.pointB.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
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
      expect(wr!.previewLowerRight!.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo((20 / SHEET_UNITS_TO_PIXELS) + 50, 2);

      // The user can move the cursor all they want...
      toolManager.handleMouseMove(new ScreenPosition(999, 555), viewport);

      // ... but the size still stays the same
      wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo((20 / SHEET_UNITS_TO_PIXELS) + 50, 2);

      // Click to create the rectangle
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the rectangle was added
      expect(geometryStore.rectangles).toHaveLength(1);
      const rect = geometryStore.rectangles[0];
      expect(rect.upperLeft.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.upperLeft.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(rect.lowerRight.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(rect.lowerRight.y).toBeCloseTo((20 / SHEET_UNITS_TO_PIXELS) + 50, 2);

      // Also make sure both a top and left constraint were added
      expect(geometryStore.constraints).toHaveLength(2);

      const topConstraint = geometryStore.constraints[0];
      expect(topConstraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(topConstraint.constrainedLength.magnitude).toStrictEqual(100);
      expect(topConstraint.pointA.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(topConstraint.pointA.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(topConstraint.pointB.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(topConstraint.pointB.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);

      const leftConstraint = geometryStore.constraints[1];
      expect(leftConstraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(leftConstraint.constrainedLength.magnitude).toStrictEqual(50);
      expect(leftConstraint.pointA.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(leftConstraint.pointA.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(leftConstraint.pointB.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(leftConstraint.pointB.y).toBeCloseTo((20 / SHEET_UNITS_TO_PIXELS) + 50, 2);
    });
    it('should be able to reset a cosntraint after setting it', () => {
      // Click to start rectangle
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingRectangle).not.toBeNull();

      // Update the top working constraint to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [{ ...old[0], constrainedLength: new CentimetersLength(100) }, ...old.slice(1)]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working rectangle is now 100cm wide
      let wr = geometryStore.workingRectangle;
      expect(wr).not.toBeNull();
      expect(wr!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.firstPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(wr!.previewLowerRight!.x).toBeCloseTo((10 / SHEET_UNITS_TO_PIXELS) + 100, 2);
      expect(wr!.previewLowerRight!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 2);

      // Reset top working constraint to be unset
      geometryStore.setWorkingConstraints((old) => [{ ...old[0], constrainedLength: null }, ...old.slice(1)]);

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
  });
});
