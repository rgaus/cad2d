import { HistoryManager } from '../lib/history/HistoryManager';
import { PolygonStore } from '../lib/tools/PolygonStore';
import type { Polygon, PolygonSegment } from '../lib/tools/types';
import { SheetPosition } from '../lib/viewport/types';

function makePolygon(id: string, points: Array<{ x: number; y: number }>): Polygon {
  return {
    id,
    points: points.map(p => ({ type: 'point' as const, point: new SheetPosition(p.x, p.y) })),
    closed: false,
  };
}

describe('HistoryManager', () => {
  let polygonStore: PolygonStore;
  let historyManager: HistoryManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    polygonStore = new PolygonStore(historyManager);
    historyManager.setPolygonStore(polygonStore);
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

  describe('recordInsert / undo / redo', () => {
    it('records an insert and undo reverts it', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].id).toBe('poly-1');

      historyManager.undo();

      expect(polygonStore.polygons).toHaveLength(0);
    });

    it('redo re-inserts a deleted polygon with the same ID', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);
      polygonStore.deletePolygonDirect('poly-1');
      historyManager.recordDelete(polygon);

      expect(polygonStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].id).toBe('poly-1');

      historyManager.redo();

      expect(polygonStore.polygons).toHaveLength(0);
    });
  });

  describe('recordDelete / undo / redo', () => {
    it('records a delete and undo reverts it', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      polygonStore.deletePolygonDirect('poly-1');
      historyManager.recordDelete(polygon);

      expect(polygonStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].id).toBe('poly-1');
    });

    it('redo re-deletes the polygon after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);
      polygonStore.deletePolygonDirect('poly-1');
      historyManager.recordDelete(polygon);

      historyManager.undo();
      expect(polygonStore.polygons).toHaveLength(1);

      historyManager.redo();
      expect(polygonStore.polygons).toHaveLength(0);
    });
  });

  describe('recordMove / undo / redo', () => {
    it('records a full polygon move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      const beforeSegments = polygon.points;
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(3, 3) },
        { type: 'point', point: new SheetPosition(6, 3) },
      ];

      polygonStore.polygons[0].points = afterSegments;
      historyManager.recordMove('poly-1', beforeSegments, afterSegments);

      expect(polygonStore.polygons[0].points[0].point.x).toBe(3);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(3);

      historyManager.undo();

      expect(polygonStore.polygons[0].points[0].point.x).toBe(1);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(1);

      historyManager.redo();

      expect(polygonStore.polygons[0].points[0].point.x).toBe(3);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(3);
    });
  });

  describe('recordMoveVertex / undo / redo', () => {
    it('records a vertex move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      const beforePoint = new SheetPosition(1, 1);
      const afterPoint = new SheetPosition(5, 5);

      const segments: Array<PolygonSegment> = [...polygonStore.polygons[0].points];
      segments[0] = { type: 'point', point: afterPoint };
      polygonStore.polygons[0].points = segments;

      historyManager.recordMoveVertex('poly-1', 0, beforePoint, afterPoint);

      expect(polygonStore.polygons[0].points[0].point.x).toBe(5);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(5);

      historyManager.undo();

      expect(polygonStore.polygons[0].points[0].point.x).toBe(1);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(1);

      historyManager.redo();

      expect(polygonStore.polygons[0].points[0].point.x).toBe(5);
      expect(polygonStore.polygons[0].points[0].point.y).toBe(5);
    });
  });

  describe('recordMoveControlPoint / undo / redo', () => {
    it('records a control point move and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-quadratic', point: new SheetPosition(4, 0), controlPoint: new SheetPosition(2, 2) },
        ],
      };
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      const beforePoint = new SheetPosition(2, 2);
      const afterPoint = new SheetPosition(3, 3);

      const segments: Array<PolygonSegment> = [...polygonStore.polygons[0].points];
      segments[1] = { type: 'arc-quadratic', point: new SheetPosition(4, 0), controlPoint: afterPoint };
      polygonStore.polygons[0].points = segments;

      historyManager.recordMoveControlPoint('poly-1', 1, 'controlPoint', beforePoint, afterPoint);

      const cp = (polygonStore.polygons[0].points[1] as any).controlPoint;
      expect(cp.x).toBe(3);
      expect(cp.y).toBe(3);

      historyManager.undo();

      const cpUndo = (polygonStore.polygons[0].points[1] as any).controlPoint;
      expect(cpUndo.x).toBe(2);
      expect(cpUndo.y).toBe(2);

      historyManager.redo();

      const cpRedo = (polygonStore.polygons[0].points[1] as any).controlPoint;
      expect(cpRedo.x).toBe(3);
      expect(cpRedo.y).toBe(3);
    });

    it('handles cubic bezier control points A and B', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: new SheetPosition(1, 2), controlPointB: new SheetPosition(3, 2) },
        ],
      };
      polygonStore.addPolygonDirect(polygon);
      historyManager.recordInsert(polygon);

      const beforePoint = new SheetPosition(1, 2);
      const afterPoint = new SheetPosition(2, 3);

      const segments: Array<PolygonSegment> = [...polygonStore.polygons[0].points];
      segments[1] = { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: afterPoint, controlPointB: new SheetPosition(3, 2) };
      polygonStore.polygons[0].points = segments;

      historyManager.recordMoveControlPoint('poly-1', 1, 'controlPointA', beforePoint, afterPoint);

      const cpA = (polygonStore.polygons[0].points[1] as any).controlPointA;
      expect(cpA.x).toBe(2);
      expect(cpA.y).toBe(3);

      historyManager.undo();

      const cpAUndo = (polygonStore.polygons[0].points[1] as any).controlPointA;
      expect(cpAUndo.x).toBe(1);
      expect(cpAUndo.y).toBe(2);
    });
  });

  describe('redo stack clearing', () => {
    it('clears redo stack when a new operation is recorded', () => {
      polygonStore.addPolygon({ points: [], closed: false });
      historyManager.recordInsert(polygonStore.polygons[0]);

      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);

      polygonStore.addPolygon({ points: [], closed: false });
      historyManager.recordInsert(polygonStore.polygons[polygonStore.polygons.length - 1]);

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
      historyManager.recordInsert(polygon);
      expect(historyManager.canUndo()).toBe(true);
    });

    it('canRedo is true after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordInsert(polygon);
      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe('stacksChange event', () => {
    it('emits stacksChange when push is called', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordInsert(polygon);
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on undo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordInsert(polygon);
      handler.mockClear();
      historyManager.undo();
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on redo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.recordInsert(polygon);
      historyManager.undo();
      handler.mockClear();
      historyManager.redo();
      expect(handler).toHaveBeenCalled();
    });
  });
});
