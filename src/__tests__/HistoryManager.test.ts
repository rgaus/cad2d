import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { type ConstraintEndpoint, type Polygon, type PolygonSegment, type LinearConstraint } from '@/lib/geometry';
import { SheetPosition } from '@/lib/viewport/types';
import { Length } from '@/lib/units/length';

function makePolygon(id: string, points: Array<{ x: number; y: number }>): Polygon {
  return {
    id,
    points: points.map(p => ({ type: 'point' as const, point: new SheetPosition(p.x, p.y) })),
    closed: false,
    fillColor: null,
    openAtIndex: 0,
    renderOrder: 0,
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
      historyManager.push(UndoEntry.polygonInsert(polygon));

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe('poly-1');

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(0);
    });

    it('redo re-inserts a deleted polygon with the same ID', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      geometryStore.deletePolygonDirect('poly-1');
      historyManager.push(UndoEntry.polygonDelete(polygon));

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
      historyManager.push(UndoEntry.polygonInsert(polygon));

      geometryStore.deletePolygonDirect('poly-1');
      historyManager.push(UndoEntry.polygonDelete(polygon));

      expect(geometryStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe('poly-1');
    });

    it('redo re-deletes the polygon after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      geometryStore.deletePolygonDirect('poly-1');
      historyManager.push(UndoEntry.polygonDelete(polygon));

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
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforeSegments = polygon.points;
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(3, 3) },
        { type: 'point', point: new SheetPosition(6, 3) },
      ];

      geometryStore.polygons[0].points = afterSegments;
      historyManager.push(UndoEntry.polygonMove('poly-1', beforeSegments, afterSegments));

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
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforePoint = new SheetPosition(1, 1);
      const afterPoint = new SheetPosition(5, 5);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[0] = { type: 'point', point: afterPoint };
      geometryStore.polygons[0].points = segments;

      historyManager.push(UndoEntry.polygonMoveVertex('poly-1', 0, beforePoint, afterPoint));

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
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(1, 1) },
          { type: 'point', point: new SheetPosition(4, 1) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforePoint = new SheetPosition(2, 2);
      const afterPoint = new SheetPosition(3, 3);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[1] = { type: 'arc-quadratic', point: new SheetPosition(4, 0), controlPoint: afterPoint };
      geometryStore.polygons[0].points = segments;

      historyManager.push(UndoEntry.polygonMoveControlPoint('poly-1', 1, 'controlPoint', beforePoint, afterPoint));

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
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: new SheetPosition(1, 2), controlPointB: new SheetPosition(3, 2) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforePoint = new SheetPosition(1, 2);
      const afterPoint = new SheetPosition(2, 3);

      const segments: Array<PolygonSegment> = [...geometryStore.polygons[0].points];
      segments[1] = { type: 'arc-cubic', point: new SheetPosition(4, 0), controlPointA: afterPoint, controlPointB: new SheetPosition(3, 2) };
      geometryStore.polygons[0].points = segments;

      historyManager.push(UndoEntry.polygonMoveControlPoint('poly-1', 1, 'controlPointA', beforePoint, afterPoint));

      const cpA = (geometryStore.polygons[0].points[1] as any).controlPointA;
      expect(cpA.x).toBe(2);
      expect(cpA.y).toBe(3);

      historyManager.undo();

      const cpAUndo = (geometryStore.polygons[0].points[1] as any).controlPointA;
      expect(cpAUndo.x).toBe(1);
      expect(cpAUndo.y).toBe(2);
    });
  });

  describe('apply / polygon-translate / undo / redo', () => {
    it('translates all points of a linear polygon by the given delta', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'point', point: new SheetPosition(10, 5) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      historyManager.apply(UndoEntry.polygonTranslate('poly-1', 3, 2));

      expect(geometryStore.polygons[0].points[0].point.x).toBe(3);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(2);
      expect(geometryStore.polygons[0].points[1].point.x).toBe(13);
      expect(geometryStore.polygons[0].points[1].point.y).toBe(7);

      historyManager.undo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(0);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(0);
      expect(geometryStore.polygons[0].points[1].point.x).toBe(10);
      expect(geometryStore.polygons[0].points[1].point.y).toBe(5);

      historyManager.redo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(3);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(2);
      expect(geometryStore.polygons[0].points[1].point.x).toBe(13);
      expect(geometryStore.polygons[0].points[1].point.y).toBe(7);
    });

    it('translates control points of arc segments along with main points', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-quadratic', point: new SheetPosition(10, 0), controlPoint: new SheetPosition(5, 10) },
          { type: 'arc-cubic', point: new SheetPosition(20, 0), controlPointA: new SheetPosition(12, 8), controlPointB: new SheetPosition(18, 8) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      historyManager.apply(UndoEntry.polygonTranslate('poly-1', 5, -3));

      const pts = geometryStore.polygons[0].points;
      expect(pts[0].point.x).toBe(5);
      expect(pts[0].point.y).toBe(-3);
      expect(pts[1].point.x).toBe(15);
      expect(pts[1].point.y).toBe(-3);
      expect(pts[2].point.x).toBe(25);
      expect(pts[2].point.y).toBe(-3);

      const q = pts[1] as any;
      expect(q.controlPoint.x).toBe(10);
      expect(q.controlPoint.y).toBe(7);

      const c = pts[2] as any;
      expect(c.controlPointA.x).toBe(17);
      expect(c.controlPointA.y).toBe(5);
      expect(c.controlPointB.x).toBe(23);
      expect(c.controlPointB.y).toBe(5);

      historyManager.undo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(0);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(0);

      historyManager.redo();

      expect(geometryStore.polygons[0].points[0].point.x).toBe(5);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(-3);
    });

  });

  describe('apply / polygon-bounding-box-resize / undo / redo', () => {
    it('resizes all points by writing afterSegments and undos/redos correctly', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'point', point: new SheetPosition(100, 0) },
          { type: 'point', point: new SheetPosition(100, 50) },
          { type: 'point', point: new SheetPosition(0, 50) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforeSegments = polygon.points;
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(200, 0) },
        { type: 'point', point: new SheetPosition(200, 100) },
        { type: 'point', point: new SheetPosition(0, 100) },
      ];

      historyManager.apply(UndoEntry.polygonBoundingBoxResize('poly-1', beforeSegments, afterSegments));

      expect(geometryStore.polygons[0].points[0].point.x).toBe(0);
      expect(geometryStore.polygons[0].points[0].point.y).toBe(0);
      expect(geometryStore.polygons[0].points[1].point.x).toBe(200);
      expect(geometryStore.polygons[0].points[1].point.y).toBe(0);
      expect(geometryStore.polygons[0].points[2].point.x).toBe(200);
      expect(geometryStore.polygons[0].points[2].point.y).toBe(100);
      expect(geometryStore.polygons[0].points[3].point.x).toBe(0);
      expect(geometryStore.polygons[0].points[3].point.y).toBe(100);

      historyManager.undo();

      expect(geometryStore.polygons[0].points[1].point.x).toBe(100);
      expect(geometryStore.polygons[0].points[2].point.y).toBe(50);

      historyManager.redo();

      expect(geometryStore.polygons[0].points[1].point.x).toBe(200);
      expect(geometryStore.polygons[0].points[2].point.y).toBe(100);
    });

    it('resizes arc-quadratic and arc-cubic segments including control points', () => {
      const polygon: Polygon = {
        id: 'poly-1',
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
        points: [
          { type: 'point', point: new SheetPosition(0, 0) },
          { type: 'arc-quadratic', point: new SheetPosition(100, 0), controlPoint: new SheetPosition(50, 20) },
          { type: 'arc-cubic', point: new SheetPosition(100, 50), controlPointA: new SheetPosition(120, 10), controlPointB: new SheetPosition(120, 40) },
          { type: 'point', point: new SheetPosition(0, 50) },
        ],
      };
      geometryStore.addPolygonDirect(polygon);
      historyManager.push(UndoEntry.polygonInsert(polygon));

      const beforeSegments = polygon.points;
      // Double width and height: (0,0)-(200,0)-(200,100)-(0,100)
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'arc-quadratic', point: new SheetPosition(200, 0), controlPoint: new SheetPosition(100, 40) },
        { type: 'arc-cubic', point: new SheetPosition(200, 100), controlPointA: new SheetPosition(240, 20), controlPointB: new SheetPosition(240, 80) },
        { type: 'point', point: new SheetPosition(0, 100) },
      ];

      historyManager.apply(UndoEntry.polygonBoundingBoxResize('poly-1', beforeSegments, afterSegments));

      const pts = geometryStore.polygons[0].points;
      const q = pts[1] as any;
      expect(q.controlPoint.x).toBe(100);
      expect(q.controlPoint.y).toBe(40);

      const c = pts[2] as any;
      expect(c.controlPointA.x).toBe(240);
      expect(c.controlPointA.y).toBe(20);
      expect(c.controlPointB.x).toBe(240);
      expect(c.controlPointB.y).toBe(80);

      historyManager.undo();

      const qUndo = geometryStore.polygons[0].points[1] as any;
      expect(qUndo.controlPoint.x).toBe(50);
      expect(qUndo.controlPoint.y).toBe(20);

      historyManager.redo();

      const qRedo = geometryStore.polygons[0].points[1] as any;
      expect(qRedo.controlPoint.x).toBe(100);
      expect(qRedo.controlPoint.y).toBe(40);
    });

  });

  describe('redo stack clearing', () => {
    it('clears redo stack when a new operation is recorded', () => {
      geometryStore.addPolygon({ points: [], closed: false, fillColor: null, openAtIndex: 0 });
      historyManager.push(UndoEntry.polygonInsert(geometryStore.polygons[0]));

      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);

      geometryStore.addPolygon({ points: [], closed: false, fillColor: null, openAtIndex: 0 });
      historyManager.push(UndoEntry.polygonInsert(geometryStore.polygons[geometryStore.polygons.length - 1]));

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
      historyManager.push(UndoEntry.polygonInsert(polygon));
      expect(historyManager.canUndo()).toBe(true);
    });

    it('canRedo is true after undo', () => {
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe('stacksChange event', () => {
    it('emits stacksChange when push is called', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on undo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      handler.mockClear();
      historyManager.undo();
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on redo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      const polygon = makePolygon('poly-1', [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
      historyManager.push(UndoEntry.polygonInsert(polygon));
      historyManager.undo();
      handler.mockClear();
      historyManager.redo();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('recordLinearConstraintInsert / undo / redo', () => {
    it('records an insert and undo reverts it', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe('constraint-1');

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(0);
    });

    it('redo re-inserts a deleted constraint with the same ID', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));
      geometryStore.deleteConstraintDirect('constraint-1');
      historyManager.push(UndoEntry.linearConstraintDelete(constraint));

      expect(geometryStore.constraints).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe('constraint-1');

      historyManager.redo();

      expect(geometryStore.constraints).toHaveLength(0);
    });
  });

  describe('recordLinearConstraintDelete / undo / redo', () => {
    it('records a delete and undo reverts it', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));

      geometryStore.deleteConstraintDirect('constraint-1');
      historyManager.push(UndoEntry.linearConstraintDelete(constraint));

      expect(geometryStore.constraints).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe('constraint-1');
    });

    it('redo re-deletes the constraint after undo', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));
      geometryStore.deleteConstraintDirect('constraint-1');
      historyManager.push(UndoEntry.linearConstraintDelete(constraint));

      historyManager.undo();
      expect(geometryStore.constraints).toHaveLength(1);

      historyManager.redo();
      expect(geometryStore.constraints).toHaveLength(0);
    });
  });

  describe('recordLinearConstraintMoveEndpoints / undo / redo', () => {
    it('records endpoint move and undos/redos correctly', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));

      const beforePointA: ConstraintEndpoint = { type: "point", point: new SheetPosition(0, 50) };
      const beforePointB: ConstraintEndpoint = { type: "point", point: new SheetPosition(100, 50) };
      const afterPointA: ConstraintEndpoint = { type: "point", point: new SheetPosition(0, 100) };
      const afterPointB: ConstraintEndpoint = { type: "point", point: new SheetPosition(100, 100) };

      geometryStore.updateConstraintDirect('constraint-1', {
        pointA: afterPointA,
        pointB: afterPointB,
      });
      historyManager.push(UndoEntry.linearConstraintMoveEndpoints(
        'constraint-1',
        beforePointA,
        beforePointB,
        afterPointA,
        afterPointB,
      ));

      expect((geometryStore.constraints[0].pointA as any).point.y).toBe(100);
      expect((geometryStore.constraints[0].pointB as any).point.y).toBe(100);

      historyManager.undo();

      expect((geometryStore.constraints[0].pointA as any).point.x).toBe(0);
      expect((geometryStore.constraints[0].pointA as any).point.y).toBe(50);
      expect((geometryStore.constraints[0].pointB as any).point.y).toBe(50);

      historyManager.redo();

      expect((geometryStore.constraints[0].pointA as any).point.y).toBe(100);
      expect((geometryStore.constraints[0].pointB as any).point.y).toBe(100);
    });
  });

  describe('recordLinearConstraintMoveLabel / undo / redo', () => {
    it('records label offset move and undos/redos correctly', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));

      geometryStore.updateConstraintDirect('constraint-1', {
        connectorLineOffsetPx: 10,
      });
      historyManager.push(UndoEntry.linearConstraintMoveLabel('constraint-1', -12, 10));

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(10);

      historyManager.undo();

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(-12);

      historyManager.redo();

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(10);
    });
  });

  describe('recordLinearConstraintChangeLength / undo / redo', () => {
    it('records constrained length change and undos/redos correctly', () => {
      const constraint: LinearConstraint = {
        id: 'constraint-1',
        type: 'linear',
        pointA: { type: "point", point: new SheetPosition(0, 50) },
        pointB: { type: "point", point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      };
      geometryStore.addConstraintDirect(constraint);
      historyManager.push(UndoEntry.linearConstraintInsert(constraint));

      geometryStore.updateConstraintDirect('constraint-1', {
        constrainedLength: Length.centimeters(20),
      });
      historyManager.push(UndoEntry.linearConstraintChangeLength(
        'constraint-1',
        Length.centimeters(10),
        Length.centimeters(20),
      ));

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(20);

      historyManager.undo();

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(10);

      historyManager.redo();

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(20);
    });
  });
});
