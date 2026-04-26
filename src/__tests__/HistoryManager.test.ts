import { HistoryManager } from '../lib/history/HistoryManager';
import { GeometryStore } from '../lib/tools/GeometryStore';
import type { Polygon, PolygonSegment } from '../lib/tools/types';
import { SheetPosition } from '../lib/viewport/types';

function makePolygon(id: string, points: Array<{ x: number; y: number }>): Polygon {
  return {
    id,
    points: points.map(p => ({ type: 'point' as const, point: new SheetPosition(p.x, p.y) })),
    closed: false, fillColor: null, openAtIndex: 0,
  };
}

describe('HistoryManager', () => {
  let geometryStore: GeometryStore;
  let historyManager: HistoryManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  describe('generateStableId', () => {
    it('generates a valid UUID', () => {
      const id = historyManager.generateStableId();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('generates unique IDs', () => {
      const id1 = historyManager.generateStableId();
      const id2 = historyManager.generateStableId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('recordPolygonInsert / undo / redo', () => {
    it('records an insert and undo reverts it', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe('poly-1');

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(0);
    });

    it('redo re-inserts a deleted polygon with the same ID', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);
      geometryStore.deletePolygonDirect('poly-1');
      historyManager.recordPolygonDelete(polygon);

      expect(geometryStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe('poly-1');

      historyManager.redo();

      expect(geometryStore.polygons).toHaveLength(0);
    });
  });

  describe('recordPolygonDelete / undo / redo', () => {
    it('records a delete and undo reverts it', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      geometryStore.deletePolygonDirect('poly-1');
      historyManager.recordPolygonDelete(polygon);

      expect(geometryStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe('poly-1');
    });

    it('redo re-deletes the polygon after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);
      geometryStore.deletePolygonDirect('poly-1');
      historyManager.recordPolygonDelete(polygon);

      historyManager.undo();
      expect(geometryStore.polygons).toHaveLength(1);

      historyManager.redo();
      expect(geometryStore.polygons).toHaveLength(0);
    });
  });

  describe('recordPolygonMove / undo / redo', () => {
    it('records a full polygon move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false, fillColor: null, openAtIndex: 0,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      const beforeSegments = polygon.points;
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(3, 3) },
        { type: 'point', point: new SheetPosition(6, 3) },
      ];

      geometryStore.polygons[0].points = afterSegments;
      historyManager.recordPolygonMove('poly-1', beforeSegments, afterSegments);

      expect(geometryStore.polygons[0].points[0].point.x).toBe(3);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(3);

      historyManager.undo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(1);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(1);

      historyManager.redo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(3);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(3);
    });
  });

  describe('recordPolygonMoveVertex / undo / redo', () => {
    it('records a vertex move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false, fillColor: null, openAtIndex: 0,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      const beforePoint = new SheetPosition(1, 1);
      const afterPoint = new SheetPosition(5, 5);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[0] = { type: 'point', point: afterPoint };
      geometryStore.polygons[0].points = segments;

      historyManager.recordPolygonMoveVertex('poly-1', 0, beforePoint, afterPoint);

      expect(geometryStore.polygons[0].points[0].point.x).toBe(5);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(5);

      historyManager.undo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(1);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(1);

      historyManager.redo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(5);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(5);
    });
  });

  describe('recordPolygonMoveControlPoint / undo / redo', () => {
    it('records a control point move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false, fillColor: null, openAtIndex: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-quadratic', point: new SheetPosition(4, 0), controlPoint: new SheetPosition(2, 2) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      const beforePoint = new SheetPosition(2, 2);
      const afterPoint = new SheetPosition(3, 3);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[1] = { type: 'arc-quadratic', point: new SheetPosition(4, 0), controlPoint: afterPoint };
      geometryStore.polygons[0].points = segments;

      historyManager.recordPolygonMoveControlPoint('poly-1', 1, 'controlPoint', beforePoint, afterPoint);

      const cp = (geometryStore.polygons[0].points[1] as any).controlPoint;
      expect(cp.x).toBe(3);
      expect(cp.y).toBe(3);

      historyManager.undo();

      const cpUndo = (geometryStore.polygons[0].points[1] as any).controlPoint;
      expect(cpUndo.x).toBe(2);
      expect(cpUndo.y).toBe(2);

      historyManager.redo();

      const cpRedo = (geometryStore.polygons[0].points[1] as any).controlPoint;
      expect(cpRedo.x).toBe(3);
      expect(cpRedo.y).toBe(3);
    });

    it('handles cubic bezier control points A and B', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false, fillColor: null, openAtIndex: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: new SheetPosition(1, 2), controlPointB: new SheetPosition(3, 2) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.recordPolygonInsert(polygon);

      const beforePoint = new SheetPosition(1, 2);
      const afterPoint = new SheetPosition(2, 3);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[1] = { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: afterPoint, controlPointB: new SheetPosition(3, 2) };
      geometryStore.polygons[0].points = segments;

      historyManager.recordPolygonMoveControlPoint('poly-1', 1, 'controlPointA', beforePoint, afterPoint);

      const cpA = (geometryStore.polygons[0].points[1] as any).controlPointA;
      expect(cpA.x).toBe(2);
      expect(cpA.y).toBe(3);

      historyManager.undo();

      const cpAUndo = (geometryStore.polygons[0].points[1] as any).controlPointA;
      expect(cpAUndo.x).toBe(1);
      expect(cpAUndo.y).toBe(2);
    });
  });

  describe('redo stack clearing', () => {
    it('clears redo stack when a new operation is recorded', () => {
      geometryStore.addPolygon({ points: [], closed: false, fillColor: null, openAtIndex: 0 });
      historyManager.recordPolygonInsert(geometryStore.polygons[0]);

      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);

      geometryStore.addPolygon({ points: [], closed: false, fillColor: null, openAtIndex: 0 });
      historyManager.recordPolygonInsert(geometryStore.polygons[geometryStore.polygons.length - 1]);

      expect(historyManager.canRedo()).toBe(false);
    });
  });

  describe('canUndo / canRedo', () => {
    it('canUndo is false when no operations recorded', () => {
      expect(historyManager.canUndo()).toBe(false);
    });

    it('canRedo is false when no operations undone', () => {
      expect(historyManager.canRedo()).toBe(false);
    });

    it('canUndo is true after recording an operation', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordPolygonInsert(polygon);
      expect(historyManager.canUndo()).toBe(true);
    });

    it('canRedo is true after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordPolygonInsert(polygon);
      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe('stacksChange event', () => {
    it('emits stacksChange when push is called', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordPolygonInsert(polygon);
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on undo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordPolygonInsert(polygon);
      handler.mockClear();
      historyManager.undo();
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on redo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordPolygonInsert(polygon);
      historyManager.undo();
      handler.mockClear();
      historyManager.redo();
      expect(handler).toHaveBeenCalled();
    });
  });
});
