import { EllipseTool } from '../lib/tools/EllipseTool';
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

describe('EllipseTool', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let ellipseTool: EllipseTool;
  let viewport: ViewportState;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    ellipseTool = toolManager.getTool('ellipse') as EllipseTool;
    viewport = createViewportState(1);
    toolManager.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    toolManager.setActiveTool('ellipse');
  });

  describe('basic ellipse creation + completion', () => {
    it('first click creates working ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.firstPoint).not.toBeNull();
      expect(we!.previewPoint).toBeNull();
      expect(we!.isCenterMode).toBe(false);
    });

    it('mouse move updates preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('second click completes ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);
      expect(geometryStore.ellipses).toHaveLength(1);
      expect(geometryStore.workingEllipse).toBeNull();

      const ellipse = geometryStore.ellipses[0];
      const centerX = 20 / SHEET_UNITS_TO_PIXELS;
      const centerY = 15 / SHEET_UNITS_TO_PIXELS;
      const radiusX = 10 / SHEET_UNITS_TO_PIXELS;
      const radiusY = 5 / SHEET_UNITS_TO_PIXELS;
      expect(ellipse.center.x).toBeCloseTo(centerX, 2);
      expect(ellipse.center.y).toBeCloseTo(centerY, 2);
      expect(ellipse.radiusX).toBeCloseTo(radiusX, 2);
      expect(ellipse.radiusY).toBeCloseTo(radiusY, 2);
    });

    it('clicking same location twice should not complete zero-size ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.ellipses).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });
  });

  describe('corner mode bounds', () => {
    it('center computed from bounding box corners', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);

      const ellipse = geometryStore.ellipses[0];
      expect(ellipse.center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('clicking in reverse order produces same bounds', () => {
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      const ellipse = geometryStore.ellipses[0];
      expect(ellipse.center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('center mode', () => {
    it('alt on first click enters center mode', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.isCenterMode).toBe(true);
      expect(we!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.firstPoint!.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('center mode uses second point as direct radius', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);

      const ellipse = geometryStore.ellipses[0];
      expect(ellipse.center.x).toBeCloseTo(0.156, 2);
      expect(ellipse.center.y).toBeCloseTo(0.156, 2);
      expect(ellipse.radiusX).toBeCloseTo(0.313, 2);
      expect(ellipse.radiusY).toBeCloseTo(0.157, 2);
    });
  });

  describe('circle constraint (shift)', () => {
    it('shift held forces circular point during preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(10, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint!.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it.skip('circle constrained ellipse completes correctly', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      expect(geometryStore.ellipses).toHaveLength(1);
      const ellipse = geometryStore.ellipses[0];
      expect(ellipse.center.x).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusX).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it.skip('shift constrains correctly even when mouse moves to negative quadrant', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(5, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint!.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('alt toggles center mode', () => {
    it('alt key toggles isCenterMode while drawing', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(false);

      const events = subscribeToEvents(ellipseTool, ['isCenterModeChange']);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(true);
      expect(events.areThereBufferedEvents('isCenterModeChange')).toBe(true);
    });

    it('alt key up re-evaluates center mode from toolManager', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(true);

      toolManager.handleKeyUp({ key: 'Alt', altKey: false } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('escape aborts ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(geometryStore.workingEllipse).toBeNull();
      expect(ellipseTool.previewSheetPos).toBeNull();
    });

    it('enter completes with current preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.ellipses).toHaveLength(1);
      expect(geometryStore.workingEllipse).toBeNull();

      const ellipse = geometryStore.ellipses[0];
      expect(ellipse.center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(ellipse.radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('enter does nothing when no preview is set', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.ellipses).toHaveLength(0);
      expect(geometryStore.workingEllipse).not.toBeNull();
    });
  });

  describe('degenerate ellipse abort', () => {
    it('radiusX <= 0 triggers abort', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(10, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);

      expect(geometryStore.ellipses).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });

    it('radiusY <= 0 triggers abort', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.ellipses).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });
  });

  describe('tool focus / blur', () => {
    it('blur clears working ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      ellipseTool.handleToolBlur();

      expect(geometryStore.workingEllipse).toBeNull();
    });

    it('blur clears previewSheetPos', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      expect(ellipseTool.previewSheetPos).not.toBeNull();

      ellipseTool.handleToolBlur();

      expect(ellipseTool.previewSheetPos).toBeNull();
    });

    it('blur emits previewSheetPositionChange(null)', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      const events = subscribeToEvents(ellipseTool, ['previewSheetPositionChange']);
      ellipseTool.handleToolBlur();

      expect(events.areThereBufferedEvents('previewSheetPositionChange')).toBe(true);
      events.unsubscribe();
    });
  });
});
