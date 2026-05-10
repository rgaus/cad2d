import { RectangleTool } from '../lib/tools/RectangleTool';
import { ToolManager } from '../lib/tools/ToolManager';
import { GeometryStore } from '../lib/tools/GeometryStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { ViewportPosition, ScreenPosition, type ViewportState } from '../lib/viewport/types';
import { SHEET_UNITS_TO_PIXELS } from '../lib/sheet/Sheet';
import { subscribeToEvents } from '../lib/subscribe-to-events';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('RectangleTool', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let rectangleTool: RectangleTool;
  let viewport: ViewportState;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
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
});
