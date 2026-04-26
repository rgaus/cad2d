import { GeometryStore } from '../lib/tools/GeometryStore';
import { HistoryManager } from '../lib/history/HistoryManager';
import { SheetPosition } from '../lib/viewport/types';
import { ToolManager } from '../lib/tools/ToolManager';
import { SelectionManager } from '../lib/tools/SelectionManager';
import type { PointSegment, PolygonSegment, Rectangle, Ellipse } from '../lib/tools/types';
import { TrimSplitTool } from '../lib/tools/TrimSplitTool';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function createTestFixtures() {
  const historyManager = new HistoryManager();
  const store = new GeometryStore(historyManager);
  historyManager.setGeometryStore(store);
  const selectionManager = new SelectionManager();
  const toolManager = new ToolManager(store, selectionManager, historyManager);
  const trimTool = toolManager.getTool('trim-split') as TrimSplitTool;

  return { historyManager, store, selectionManager, toolManager, trimTool };
}

describe('TrimSplitTool', () => {
  describe('mode toggle', () => {
    it('starts in delete mode by default', () => {
      const { trimTool } = createTestFixtures();
      expect(trimTool.mode).toBe('delete');
    });

    it('toggles to split mode when x is pressed', () => {
      const { trimTool } = createTestFixtures();
      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);
      expect(trimTool.mode).toBe('split');
    });

    it('toggles back to delete mode when x is pressed again', () => {
      const { trimTool } = createTestFixtures();
      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);
      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);
      expect(trimTool.mode).toBe('delete');
    });

    it('emits modeChange event when toggling', () => {
      const { trimTool } = createTestFixtures();
      const spy = jest.fn();
      trimTool.on('modeChange', spy);
      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);
      expect(spy).toHaveBeenCalledWith('split');
    });
  });

  describe('hover detection', () => {
    it('detects hover on polygon segment', () => {
      const { store, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = new SheetPosition(5, 0).toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);

      expect(trimTool.hoveredSegment).not.toBeNull();
      expect(trimTool.hoveredSegment?.shapeType).toBe('polygon');
    });

    it('does not detect hover when no geometry exists', () => {
      const { trimTool } = createTestFixtures();

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = new SheetPosition(5, 5).toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);

      expect(trimTool.hoveredSegment).toBeNull();
    });

    it('clears hover state on tool blur', () => {
      const { store, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = new SheetPosition(5, 0).toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      expect(trimTool.hoveredSegment).not.toBeNull();

      trimTool.handleToolBlur();
      expect(trimTool.hoveredSegment).toBeNull();
    });
  });

  describe('split operation', () => {
    it('splits a polygon segment at a point', () => {
      const { store, historyManager, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const polygonId = store.polygons[0].id;
      const splitPoint = new SheetPosition(5, 0);

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      const polygon = store.polygons.find(p => p.id === polygonId);
      expect(polygon).toBeDefined();
      expect(polygon!.points.length).toBe(6);
    });

    it('records split operation to history', () => {
      const { store, historyManager, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const polygonId = store.polygons[0].id;
      const splitPoint = new SheetPosition(5, 0);

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      expect(historyManager.canUndo()).toBe(true);
    });
  });

  describe('delete operation', () => {
    it('deletes a polygon segment', () => {
      const { store, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const polygonId = store.polygons[0].id;
      const originalPointCount = store.polygons[0].points.length;
      const deletePoint = new SheetPosition(5, 0);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = deletePoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      const polygon = store.polygons.find(p => p.id === polygonId);
      expect(polygon).toBeDefined();
      expect(polygon!.points.length).toBeLessThan(originalPointCount);
    });
  });

  describe('rectangle conversion', () => {
    it('converts rectangle to polygon on split', () => {
      const { store, trimTool } = createTestFixtures();
      store.addRectangle({
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
      });

      expect(store.rectangles).toHaveLength(1);
      expect(store.polygons).toHaveLength(0);

      const rectangleId = store.rectangles[0].id;
      const splitPoint = new SheetPosition(5, 0);

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      expect(store.rectangles).toHaveLength(0);
      expect(store.polygons.length).toBeGreaterThan(0);
    });
  });

  describe('ellipse conversion', () => {
    it('converts ellipse to polygon on split', () => {
      const { store, trimTool } = createTestFixtures();
      store.addEllipse({
        center: new SheetPosition(5, 5),
        radiusX: 5,
        radiusY: 3,
      });

      expect(store.ellipses).toHaveLength(1);
      expect(store.polygons).toHaveLength(0);

      const ellipseId = store.ellipses[0].id;
      const splitPoint = new SheetPosition(5, 2);

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      expect(store.ellipses).toHaveLength(0);
      expect(store.polygons.length).toBeGreaterThan(0);
    });
  });

  describe('undo/redo', () => {
    it('undoes split operation', () => {
      const { store, historyManager, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const polygonId = store.polygons[0].id;
      const originalPointCount = store.polygons[0].points.length;

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const splitPoint = new SheetPosition(5, 0);
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      expect(store.polygons.find(p => p.id === polygonId)!.points.length).toBeGreaterThan(originalPointCount);

      historyManager.undo();

      expect(store.polygons.find(p => p.id === polygonId)!.points.length).toBe(originalPointCount);
    });

    it('redoes split operation', () => {
      const { store, historyManager, trimTool } = createTestFixtures();
      store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const polygonId = store.polygons[0].id;
      const originalPointCount = store.polygons[0].points.length;

      trimTool.handleKeyDown({ key: 'x' } as KeyboardEvent);

      const viewport = {
        position: { x: 0, y: 0, type: Symbol('viewport') } as any,
        scale: 1,
      };
      const splitPoint = new SheetPosition(5, 0);
      const screenPos = splitPoint.toWorld().toScreen(viewport as any);

      trimTool.handleMouseMove(screenPos as any, viewport as any);
      trimTool.handleMouseDown(screenPos as any, viewport as any);

      historyManager.undo();
      expect(store.polygons.find(p => p.id === polygonId)!.points.length).toBe(originalPointCount);

      historyManager.redo();
      expect(store.polygons.find(p => p.id === polygonId)!.points.length).toBeGreaterThan(originalPointCount);
    });
  });
});

describe('GeometryStore split/delete methods', () => {
  let historyManager: HistoryManager;
  let store: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    store = new GeometryStore(historyManager);
    historyManager.setGeometryStore(store);
  });

  describe('splitPolygonSegment', () => {
    it('splits a point segment at a new point', () => {
      const polygon = store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const originalPointCount = polygon.points.length;
      store.splitPolygonSegment(polygon.id, 0, new SheetPosition(5, 0));

      const updated = store.polygons.find(p => p.id === polygon.id);
      expect(updated!.points.length).toBe(originalPointCount + 1);
    });

    it('does nothing for non-existent polygon', () => {
      store.splitPolygonSegment('nonexistent' as any, 0, new SheetPosition(5, 0));
      expect(store.polygons).toHaveLength(0);
    });
  });

  describe('deletePolygonSegment', () => {
    it('deletes a segment from polygon', () => {
      const polygon = store.addPolygon({
        points: [
          makePoint(0, 0),
          makePoint(10, 0),
          makePoint(10, 10),
          makePoint(0, 10),
          makePoint(0, 0),
        ],
        closed: true,
      });

      const originalPointCount = polygon.points.length;
      store.deletePolygonSegment(polygon.id, 0);

      const updated = store.polygons.find(p => p.id === polygon.id);
      expect(updated!.points.length).toBe(originalPointCount - 2);
    });
  });

  describe('replaceRectangleWithPolygon', () => {
    it('replaces rectangle with polygon', () => {
      const rectangle = store.addRectangle({
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
      });

      const polygon = store.replaceRectangleWithPolygon(rectangle.id);

      expect(store.rectangles).toHaveLength(0);
      expect(polygon).not.toBeNull();
      expect(store.polygons).toContain(polygon);
    });

    it('returns null for non-existent rectangle', () => {
      const result = store.replaceRectangleWithPolygon('nonexistent' as any);
      expect(result).toBeNull();
    });
  });

  describe('replaceEllipseWithPolygon', () => {
    it('replaces ellipse with polygon', () => {
      const ellipse = store.addEllipse({
        center: new SheetPosition(5, 5),
        radiusX: 5,
        radiusY: 3,
      });

      const polygon = store.replaceEllipseWithPolygon(ellipse.id);

      expect(store.ellipses).toHaveLength(0);
      expect(polygon).not.toBeNull();
      expect(store.polygons).toContain(polygon);
    });

    it('returns null for non-existent ellipse', () => {
      const result = store.replaceEllipseWithPolygon('nonexistent' as any);
      expect(result).toBeNull();
    });
  });
});
