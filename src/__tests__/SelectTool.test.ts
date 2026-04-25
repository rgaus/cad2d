import { ToolManager } from '../lib/tools/ToolManager';
import { PolygonStore } from '../lib/tools/PolygonStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { SelectTool } from '../lib/tools/SelectTool';
import { ScreenPosition, SheetPosition } from '../lib/viewport/types';
import { Sheets, SHEET_UNITS_TO_PIXELS } from '../lib/sheet/Sheet';
import { ViewportControls } from '../lib/viewport/ViewportControls';

describe('SelectTool', () => {
  let polygonStore: PolygonStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let selectTool: SelectTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    historyManager = new HistoryManager();
    polygonStore = new PolygonStore(historyManager);
    historyManager.setPolygonStore(polygonStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(polygonStore, selectionManager, historyManager);
    selectTool = toolManager.getTool('select') as SelectTool;

    const sheet = Sheets.a4();
    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
  });

  describe('polygon fill drag snapping', () => {
    let addEventListenerSpy: jest.SpyInstance;
    let removeEventListenerSpy: jest.SpyInstance;
    let moveHandler: ((event: MouseEvent) => void) | undefined;
    let upHandler: ((event: MouseEvent) => void) | undefined;

    beforeEach(() => {
      moveHandler = undefined;
      upHandler = undefined;
      addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
      addEventListenerSpy.mockImplementation((event: string, handler: (event: MouseEvent) => void) => {
        if (event === 'mousemove') moveHandler = handler;
        if (event === 'mouseup') upHandler = handler;
      });
    });

    afterEach(() => {
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('snaps polygon points correctly when dragging from an unsnapped click position', () => {
      const polygonId = 'test-polygon';
      const originalSheetX = 3;
      const originalSheetY = 3;
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(originalSheetX, originalSheetY) },
          { type: 'point' as const, point: new SheetPosition(originalSheetX + 2, originalSheetY) },
          { type: 'point' as const, point: new SheetPosition(originalSheetX + 2, originalSheetY + 2) },
          { type: 'point' as const, point: new SheetPosition(originalSheetX, originalSheetY + 2) },
        ],
        closed: true,
      });

      const clickSheetX = 3.015;
      const clickSheetY = 3.008;
      const clickScreenX = clickSheetX * SHEET_UNITS_TO_PIXELS;
      const clickScreenY = clickSheetY * SHEET_UNITS_TO_PIXELS;

      const moveSheetX = 2;
      const moveSheetY = 3;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;

      selectTool.onPolygonFillPointerDown(
        new ScreenPosition(clickScreenX, clickScreenY),
        viewportControls,
        polygonId,
      );

      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[0].point.x).toBeCloseTo(2, 1);
      expect(polygon.points[0].point.y).toBeCloseTo(3, 1);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });

    it('keeps polygon aligned to grid when dragging from a grid-snapped position', () => {
      const polygonId = 'test-polygon-2';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      const clickSheetX = 3;
      const clickSheetY = 3;
      const clickScreenX = clickSheetX * SHEET_UNITS_TO_PIXELS;
      const clickScreenY = clickSheetY * SHEET_UNITS_TO_PIXELS;

      const moveSheetX = 2;
      const moveSheetY = 3;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;

      selectTool.onPolygonFillPointerDown(
        new ScreenPosition(clickScreenX, clickScreenY),
        viewportControls,
        polygonId,
      );

      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[0].point.x).toBeCloseTo(2, 10);
      expect(polygon.points[0].point.y).toBeCloseTo(3, 10);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });

    it('moves all control points by the same delta as the polygon fill drag', () => {
      const polygonId = 'test-polygon-3';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          {
            type: 'arc-quadratic' as const,
            point: new SheetPosition(5, 3),
            controlPoint: new SheetPosition(4, 2),
          },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
        ],
        closed: false,
      });

      const clickScreenX = 3 * SHEET_UNITS_TO_PIXELS;
      const clickScreenY = 3 * SHEET_UNITS_TO_PIXELS;

      const moveSheetX = 2;
      const moveSheetY = 3;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;

      selectTool.onPolygonFillPointerDown(
        new ScreenPosition(clickScreenX, clickScreenY),
        viewportControls,
        polygonId,
      );

      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[0].point.x).toBeCloseTo(2, 1);
      expect(polygon.points[0].point.y).toBeCloseTo(3, 1);
      expect((polygon.points[1] as { controlPoint: SheetPosition }).controlPoint.x).toBeCloseTo(3, 1);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });
  });

  describe('vertex drag', () => {
    let addEventListenerSpy: jest.SpyInstance;
    let removeEventListenerSpy: jest.SpyInstance;
    let moveHandler: ((event: MouseEvent) => void) | undefined;
    let upHandler: ((event: MouseEvent) => void) | undefined;

    beforeEach(() => {
      moveHandler = undefined;
      upHandler = undefined;
      addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
      addEventListenerSpy.mockImplementation((event: string, handler: (event: MouseEvent) => void) => {
        if (event === 'mousemove') moveHandler = handler;
        if (event === 'mouseup') upHandler = handler;
      });
    });

    afterEach(() => {
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('dragging first vertex of closed polygon moves both first and last points', () => {
      const polygonId = 'test-polygon-vertex';
      const firstPoint = new SheetPosition(10, 10);
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: firstPoint },
          { type: 'point' as const, point: new SheetPosition(15, 10) },
          { type: 'point' as const, point: new SheetPosition(15, 15) },
          { type: 'point' as const, point: new SheetPosition(10, 10) },
        ],
        closed: true,
      });

      const clickScreenX = 100;
      const clickScreenY = 100;
      const moveScreenX = 200;
      const moveScreenY = 200;

      const beforeFirst = polygonStore.polygons.find(p => p.id === polygonId)!.points[0].point.x;
      const beforeLast = polygonStore.polygons.find(p => p.id === polygonId)!.points[3].point.x;
      expect(beforeFirst).toBe(beforeLast);

      selectTool.onVertexPointerDown(
        new ScreenPosition(clickScreenX, clickScreenY),
        viewportControls,
        polygonId,
        0,
      );

      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const deltaX = polygon.points[0].point.x - beforeFirst;
      const deltaLastX = polygon.points[3].point.x - beforeLast;
      expect(deltaX).toBe(deltaLastX);
      expect(deltaX).not.toBe(0);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });

    it('dragging first vertex does not move last point if they are at different positions', () => {
      const polygonId = 'test-polygon-vertex-diff';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(10, 10) },
          { type: 'point' as const, point: new SheetPosition(15, 10) },
          { type: 'point' as const, point: new SheetPosition(15, 15) },
          { type: 'point' as const, point: new SheetPosition(10, 15) },
        ],
        closed: true,
      });

      const clickScreenX = 100;
      const clickScreenY = 100;
      const moveScreenX = 200;
      const moveScreenY = 200;

      selectTool.onVertexPointerDown(
        new ScreenPosition(clickScreenX, clickScreenY),
        viewportControls,
        polygonId,
        0,
      );

      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const firstDelta = polygon.points[0].point.x - 10;
      const lastDelta = polygon.points[3].point.x - 10;
      expect(firstDelta).not.toBe(0);
      expect(lastDelta).toBe(0);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });
  });

  describe('corner handle resize', () => {
    let addEventListenerSpy: jest.SpyInstance;
    let removeEventListenerSpy: jest.SpyInstance;
    let moveHandler: ((event: MouseEvent) => void) | undefined;
    let upHandler: ((event: MouseEvent) => void) | undefined;

    beforeEach(() => {
      moveHandler = undefined;
      upHandler = undefined;
      addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
      addEventListenerSpy.mockImplementation((event: string, handler: (event: MouseEvent) => void) => {
        if (event === 'mousemove') moveHandler = handler;
        if (event === 'mouseup') upHandler = handler;
      });
    });

    afterEach(() => {
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('resizing top-right corner keeps bottom-left corner pinned', () => {
      const polygonId = 'test-polygon-resize';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onCornerHandlePointerDown(
        viewportControls,
        polygonId,
        'top-right',
      );

      const moveSheetX = 7;
      const moveSheetY = 4;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;
      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[3].point.x).toBeCloseTo(3, 1);
      expect(polygon.points[3].point.y).toBeCloseTo(5, 1);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });

    it('resizing bottom-left corner keeps top-right corner pinned', () => {
      const polygonId = 'test-polygon-resize-2';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onCornerHandlePointerDown(
        viewportControls,
        polygonId,
        'bottom-left',
      );

      const moveSheetX = 4;
      const moveSheetY = 6;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;
      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[1].point.x).toBeCloseTo(5, 1);
      expect(polygon.points[1].point.y).toBeCloseTo(3, 1);

      upHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);
    });

    it('cancel restores original points', () => {
      const polygonId = 'test-polygon-resize-cancel';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onCornerHandlePointerDown(
        viewportControls,
        polygonId,
        'top-right',
      );

      const moveSheetX = 7;
      const moveSheetY = 4;
      const moveScreenX = moveSheetX * SHEET_UNITS_TO_PIXELS;
      const moveScreenY = moveSheetY * SHEET_UNITS_TO_PIXELS;
      moveHandler!({ clientX: moveScreenX, clientY: moveScreenY } as MouseEvent);

      selectTool.cancelActiveDrag();

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      expect(polygon.points[0].point.x).toBeCloseTo(3, 10);
      expect(polygon.points[0].point.y).toBeCloseTo(3, 10);
    });
  });

  describe('edge linear resizer', () => {
    let addEventListenerSpy: jest.SpyInstance;
    let removeEventListenerSpy: jest.SpyInstance;
    let moveHandler: ((event: MouseEvent) => void) | undefined;
    let upHandler: ((event: MouseEvent) => void) | undefined;

    beforeEach(() => {
      moveHandler = undefined;
      upHandler = undefined;
      addEventListenerSpy = jest.spyOn(window, 'addEventListener');
      removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
      addEventListenerSpy.mockImplementation((event: string, handler: (event: MouseEvent) => void) => {
        if (event === 'mousemove') moveHandler = handler;
        if (event === 'mouseup') upHandler = handler;
      });
    });

    afterEach(() => {
      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('resizing right edge scales x only', () => {
      const polygonId = 'test-polygon-edge-resize';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onLinearResizerPointerDown(
        viewportControls,
        polygonId,
        'right',
      );

      moveHandler!({ clientX: 600, clientY: 300 } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const topLeft = polygon.points[0].point;
      const topRight = polygon.points[1].point;
      expect(topLeft.x).toBeCloseTo(3, 1);
      expect(topLeft.y).toBeCloseTo(3, 1);
      expect(topRight.x).not.toBeCloseTo(5, 1);
      expect(topRight.y).toBeCloseTo(3, 1);

      upHandler!({ clientX: 600, clientY: 300 } as MouseEvent);
    });

    it('resizing top edge scales y only', () => {
      const polygonId = 'test-polygon-edge-resize-top';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onLinearResizerPointerDown(
        viewportControls,
        polygonId,
        'top',
      );

      moveHandler!({ clientX: 300, clientY: 100 } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const topLeft = polygon.points[0].point;
      const bottomRight = polygon.points[2].point;
      expect(topLeft.x).toBeCloseTo(3, 1);
      expect(topLeft.y).not.toBeCloseTo(3, 1);
      expect(bottomRight.x).toBeCloseTo(5, 1);
      expect(bottomRight.y).toBeCloseTo(5, 1);

      upHandler!({ clientX: 300, clientY: 100 } as MouseEvent);
    });

    it('resizing left edge scales x only and does not flip', () => {
      const polygonId = 'test-polygon-edge-resize-left';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onLinearResizerPointerDown(
        viewportControls,
        polygonId,
        'left',
      );

      moveHandler!({ clientX: 100, clientY: 300 } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const topLeft = polygon.points[0].point;
      const topRight = polygon.points[1].point;
      expect(topLeft.x).not.toBeCloseTo(3, 1);
      expect(topLeft.y).toBeCloseTo(3, 1);
      expect(topRight.x).toBeCloseTo(5, 1);
      expect(topRight.y).toBeCloseTo(3, 1);

      upHandler!({ clientX: 100, clientY: 300 } as MouseEvent);
    });

    it('resizing bottom edge scales y only and does not flip', () => {
      const polygonId = 'test-polygon-edge-resize-bottom';
      polygonStore.polygons.push({
        id: polygonId,
        points: [
          { type: 'point' as const, point: new SheetPosition(3, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 3) },
          { type: 'point' as const, point: new SheetPosition(5, 5) },
          { type: 'point' as const, point: new SheetPosition(3, 5) },
        ],
        closed: true,
      });

      selectTool.onLinearResizerPointerDown(
        viewportControls,
        polygonId,
        'bottom',
      );

      moveHandler!({ clientX: 300, clientY: 500 } as MouseEvent);

      const polygon = polygonStore.polygons.find(p => p.id === polygonId)!;
      const topLeft = polygon.points[0].point;
      const bottomRight = polygon.points[2].point;
      expect(topLeft.x).toBeCloseTo(3, 1);
      expect(topLeft.y).toBeCloseTo(3, 1);
      expect(bottomRight.x).toBeCloseTo(5, 1);
      expect(bottomRight.y).not.toBeCloseTo(5, 1);

      upHandler!({ clientX: 300, clientY: 500 } as MouseEvent);
    });
  });
});
