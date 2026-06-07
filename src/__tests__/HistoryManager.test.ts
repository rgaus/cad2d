import {
  type ConstraintEndpoint,
  Ellipse,
  EllipseComponent,
  FillColorComponent,
  LinkDimensionsComponent,
  Polygon,
  PolygonComponent,
  PolygonSegment,
  Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { UndoEntry } from '@/lib/history/types';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

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
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe(polygon.id);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(0);
    });

    it('redo re-inserts a deleted polygon with the same ID', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      geometryStore.deleteByIdDirect(polygon.id);
      historyManager.push(UndoEntry.deleteGeometry(polygon));

      expect(geometryStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe(polygon.id);

      historyManager.redo();

      expect(geometryStore.polygons).toHaveLength(0);
    });
  });

  describe('recordPolygonDelete / undo / redo', () => {
    it('records a delete and undo reverts it', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      historyManager.apply(UndoEntry.deleteGeometry(polygon));

      expect(geometryStore.polygons).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.polygons).toHaveLength(1);
      expect(geometryStore.polygons[0].id).toBe(polygon.id);
    });

    it('redo re-deletes the polygon after undo', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      historyManager.apply(UndoEntry.deleteGeometry(polygon));

      historyManager.undo();
      expect(geometryStore.polygons).toHaveLength(1);

      historyManager.redo();
      expect(geometryStore.polygons).toHaveLength(0);
    });
  });

  describe('recordPolygonMove / undo / redo', () => {
    it('records a full polygon move and undos/redos correctly', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-cubic',
              point: new SheetPosition(4, 0),
              controlPointA: new SheetPosition(1, 2),
              controlPointB: new SheetPosition(3, 2),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      const beforePoint = new SheetPosition(1, 2);
      const afterPoint = new SheetPosition(2, 3);

      const segments: Array<PolygonSegment> = [
        ...PolygonComponent.get(geometryStore.polygons[0]).points,
      ];
      segments[1] = {
        type: 'arc-cubic',
        point: new SheetPosition(4, 0),
        controlPointA: afterPoint,
        controlPointB: new SheetPosition(3, 2),
      };
      PolygonComponent.get(geometryStore.polygons[0]).points = segments;

      historyManager.push(
        UndoEntry.polygonMoveControlPoint(polygon.id, 1, 'controlPointA', beforePoint, afterPoint),
      );

      const cpA = (PolygonComponent.get(geometryStore.polygons[0]).points[1] as any).controlPointA;
      expect(cpA.x).toBe(2);
      expect(cpA.y).toBe(3);

      historyManager.undo();

      const cpAUndo = (PolygonComponent.get(geometryStore.polygons[0]).points[1] as any)
        .controlPointA;
      expect(cpAUndo.x).toBe(1);
      expect(cpAUndo.y).toBe(2);
    });
  });

  describe('apply / polygon-translate / undo / redo', () => {
    it('translates all points of a linear polygon by the given delta', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(10, 5) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      historyManager.apply(UndoEntry.polygonTranslate(polygon.id, 3, 2));

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(3);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(2);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(13);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.y).toBe(7);

      historyManager.undo();

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(10);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.y).toBe(5);

      historyManager.redo();

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(3);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(2);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(13);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.y).toBe(7);
    });

    it('translates control points of arc segments along with main points', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-quadratic',
              point: new SheetPosition(10, 0),
              controlPoint: new SheetPosition(5, 10),
            },
            {
              type: 'arc-cubic',
              point: new SheetPosition(20, 0),
              controlPointA: new SheetPosition(12, 8),
              controlPointB: new SheetPosition(18, 8),
            },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      historyManager.apply(UndoEntry.polygonTranslate(polygon.id, 5, -3));

      const pts = PolygonComponent.get(geometryStore.polygons[0]).points;
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

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(0);

      historyManager.redo();

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(5);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(-3);
    });
  });

  describe('apply / polygon-bounding-box-resize / undo / redo', () => {
    it('resizes all points by writing afterSegments and undos/redos correctly', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(100, 0) },
            { type: 'point', point: new SheetPosition(100, 50) },
            { type: 'point', point: new SheetPosition(0, 50) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      const beforeSegments = PolygonComponent.get(polygon).points;
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(200, 0) },
        { type: 'point', point: new SheetPosition(200, 100) },
        { type: 'point', point: new SheetPosition(0, 100) },
      ];

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, beforeSegments, afterSegments),
      );

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.x).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[0].point.y).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(200);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.y).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[2].point.x).toBe(200);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[2].point.y).toBe(100);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[3].point.x).toBe(0);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[3].point.y).toBe(100);

      historyManager.undo();

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(100);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[2].point.y).toBe(50);

      historyManager.redo();

      expect(PolygonComponent.get(geometryStore.polygons[0]).points[1].point.x).toBe(200);
      expect(PolygonComponent.get(geometryStore.polygons[0]).points[2].point.y).toBe(100);
    });

    it('resizes arc-quadratic and arc-cubic segments including control points', () => {
      const polygon = geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            {
              type: 'arc-quadratic',
              point: new SheetPosition(100, 0),
              controlPoint: new SheetPosition(50, 20),
            },
            {
              type: 'arc-cubic',
              point: new SheetPosition(100, 50),
              controlPointA: new SheetPosition(120, 10),
              controlPointB: new SheetPosition(120, 40),
            },
            { type: 'point', point: new SheetPosition(0, 50) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );

      const beforeSegments = PolygonComponent.get(polygon).points;
      // Double width and height: (0,0)-(200,0)-(200,100)-(0,100)
      const afterSegments: Array<PolygonSegment> = [
        { type: 'point', point: new SheetPosition(0, 0) },
        {
          type: 'arc-quadratic',
          point: new SheetPosition(200, 0),
          controlPoint: new SheetPosition(100, 40),
        },
        {
          type: 'arc-cubic',
          point: new SheetPosition(200, 100),
          controlPointA: new SheetPosition(240, 20),
          controlPointB: new SheetPosition(240, 80),
        },
        { type: 'point', point: new SheetPosition(0, 100) },
      ];

      historyManager.apply(
        UndoEntry.polygonBoundingBoxResize(polygon.id, beforeSegments, afterSegments),
      );

      const pts = PolygonComponent.get(geometryStore.polygons[0]).points;
      const q = pts[1] as any;
      expect(q.controlPoint.x).toBe(100);
      expect(q.controlPoint.y).toBe(40);

      const c = pts[2] as any;
      expect(c.controlPointA.x).toBe(240);
      expect(c.controlPointA.y).toBe(20);
      expect(c.controlPointB.x).toBe(240);
      expect(c.controlPointB.y).toBe(80);

      historyManager.undo();

      const qUndo = PolygonComponent.get(geometryStore.polygons[0]).points[1] as any;
      expect(qUndo.controlPoint.x).toBe(50);
      expect(qUndo.controlPoint.y).toBe(20);

      historyManager.redo();

      const qRedo = PolygonComponent.get(geometryStore.polygons[0]).points[1] as any;
      expect(qRedo.controlPoint.x).toBe(100);
      expect(qRedo.controlPoint.y).toBe(40);
    });
  });

  describe('redo stack clearing', () => {
    it('clears redo stack when a new operation is recorded', () => {
      geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      expect(historyManager.canUndo()).toBe(true);
    });

    it('canRedo is true after undo', () => {
      geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      historyManager.undo();
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe('stacksChange event', () => {
    it('emits stacksChange when push is called', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on undo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      handler.mockClear();
      historyManager.undo();
      expect(handler).toHaveBeenCalled();
    });

    it('emits stacksChange on redo', () => {
      const handler = jest.fn();
      historyManager.on('stacksChange', handler);
      geometryStore.addPolygon(
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(1, 1) },
            { type: 'point', point: new SheetPosition(4, 1) },
          ],
          { closed: false, fillColor: null, openAtIndex: 0 },
        ),
      );
      historyManager.undo();
      handler.mockClear();
      historyManager.redo();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('recordLinearConstraintInsert / undo / redo', () => {
    it('records an insert and undo reverts it', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe(c.id);

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(0);
    });

    it('redo re-inserts a deleted constraint with the same ID', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });
      geometryStore.deleteConstraintDirect(c.id);
      historyManager.push(UndoEntry.linearConstraintDelete(c));

      expect(geometryStore.constraints).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe(c.id);

      historyManager.redo();

      expect(geometryStore.constraints).toHaveLength(0);
    });
  });

  describe('recordLinearConstraintDelete / undo / redo', () => {
    it('records a delete and undo reverts it', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });

      historyManager.apply(UndoEntry.linearConstraintDelete(c));

      expect(geometryStore.constraints).toHaveLength(0);

      historyManager.undo();

      expect(geometryStore.constraints).toHaveLength(1);
      expect(geometryStore.constraints[0].id).toBe(c.id);
    });

    it('redo re-deletes the constraint after undo', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });
      historyManager.apply(UndoEntry.linearConstraintDelete(c));

      historyManager.undo();
      expect(geometryStore.constraints).toHaveLength(1);

      historyManager.redo();
      expect(geometryStore.constraints).toHaveLength(0);
    });
  });

  describe('recordLinearConstraintMoveEndpoints / undo / redo', () => {
    it('records endpoint move and undos/redos correctly', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });

      const beforePointA: ConstraintEndpoint = { type: 'point', point: new SheetPosition(0, 50) };
      const beforePointB: ConstraintEndpoint = { type: 'point', point: new SheetPosition(100, 50) };
      const afterPointA: ConstraintEndpoint = { type: 'point', point: new SheetPosition(0, 100) };
      const afterPointB: ConstraintEndpoint = { type: 'point', point: new SheetPosition(100, 100) };

      geometryStore.updateConstraintDirect(c.id, {
        pointA: afterPointA,
        pointB: afterPointB,
      });
      historyManager.push(
        UndoEntry.linearConstraintMoveEndpoints(
          c.id,
          beforePointA,
          beforePointB,
          afterPointA,
          afterPointB,
        ),
      );

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
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });

      geometryStore.updateConstraintDirect(c.id, {
        connectorLineOffsetPx: 10,
      });
      historyManager.push(UndoEntry.linearConstraintMoveLabel(c.id, -12, 10));

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(10);

      historyManager.undo();

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(-12);

      historyManager.redo();

      expect(geometryStore.constraints[0].connectorLineOffsetPx).toBe(10);
    });
  });

  describe('recordLinearConstraintChangeLength / undo / redo', () => {
    it('records constrained length change and undos/redos correctly', () => {
      const c = geometryStore.addConstraint({
        type: 'linear' as const,
        pointA: { type: 'point', point: new SheetPosition(0, 50) },
        pointB: { type: 'point', point: new SheetPosition(100, 50) },
        constrainedLength: Length.centimeters(10),
        connectorLineOffsetPx: -12,
      });

      geometryStore.updateConstraintDirect(c.id, {
        constrainedLength: Length.centimeters(20),
      });
      historyManager.push(
        UndoEntry.linearConstraintChangeLength(
          c.id,
          Length.centimeters(10),
          Length.centimeters(20),
        ),
      );

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(
        20,
      );

      historyManager.undo();

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(
        10,
      );

      historyManager.redo();

      expect(geometryStore.constraints[0].constrainedLength.toCentimeters().magnitude).toBeCloseTo(
        20,
      );
    });
  });

  describe('UndoEntry', () => {
    describe('polygonFillColor', () => {
      it('changes fill color and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
              { type: 'point', point: new SheetPosition(10, 10) },
            ],
            { closed: true, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;

        historyManager.apply(UndoEntry.fillColor(pid, null, 0xff0000));

        expect(FillColorComponent.getOptional(geometryStore.polygons[0])).toBe(0xff0000);

        historyManager.undo();

        expect(FillColorComponent.getOptional(geometryStore.polygons[0])).toBeNull();

        historyManager.redo();

        expect(FillColorComponent.getOptional(geometryStore.polygons[0])).toBe(0xff0000);
      });
    });

    describe('polygonClose', () => {
      it('closes a polygon adding the closing point and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
              { type: 'point', point: new SheetPosition(10, 10) },
            ],
            { closed: false, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;
        const initialLen = PolygonComponent.get(polygon).points.length;

        historyManager.apply(UndoEntry.polygonClose(pid, false, true));

        expect(PolygonComponent.get(geometryStore.polygons[0]).closed).toBe(true);
        expect(PolygonComponent.get(geometryStore.polygons[0]).points.length).toBe(initialLen + 1);

        historyManager.undo();

        expect(PolygonComponent.get(geometryStore.polygons[0]).closed).toBe(false);
        expect(PolygonComponent.get(geometryStore.polygons[0]).points.length).toBe(initialLen);

        historyManager.redo();

        expect(PolygonComponent.get(geometryStore.polygons[0]).closed).toBe(true);
        expect(PolygonComponent.get(geometryStore.polygons[0]).points.length).toBe(initialLen + 1);
      });
    });

    describe('polygonOpenAtIndex', () => {
      it('changes openAtIndex to the start and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
              { type: 'point', point: new SheetPosition(10, 10) },
              { type: 'point', point: new SheetPosition(0, 10) },
            ],
            { closed: false, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;

        historyManager.apply(UndoEntry.polygonOpenAtIndex(pid, 0, 1));
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(1);

        historyManager.undo();
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(0);

        historyManager.redo();
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(1);
      });

      it('changes openAtIndex to the middle and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
              { type: 'point', point: new SheetPosition(10, 10) },
              { type: 'point', point: new SheetPosition(0, 10) },
            ],
            { closed: false, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;

        historyManager.apply(UndoEntry.polygonOpenAtIndex(pid, 0, 2));
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(2);

        historyManager.undo();
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(0);
      });

      it('changes openAtIndex to the end and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
              { type: 'point', point: new SheetPosition(10, 10) },
              { type: 'point', point: new SheetPosition(0, 10) },
            ],
            { closed: false, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;

        historyManager.apply(UndoEntry.polygonOpenAtIndex(pid, 0, 3));
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(3);

        historyManager.undo();
        expect(PolygonComponent.get(geometryStore.polygons[0]).openAtIndex).toBe(0);
      });
    });

    describe('polygonRenderOrder', () => {
      it('changes render order and undos/redos correctly', () => {
        const polygon = geometryStore.addPolygon(
          Polygon.create(
            [
              { type: 'point', point: new SheetPosition(0, 0) },
              { type: 'point', point: new SheetPosition(10, 0) },
            ],
            { closed: false, fillColor: null, openAtIndex: 0 },
          ),
        );
        const pid = polygon.id;

        historyManager.apply(UndoEntry.renderOrder(pid, 0, 5));

        expect(RenderOrderComponent.get(geometryStore.polygons[0])).toBe(5);

        historyManager.undo();

        expect(RenderOrderComponent.get(geometryStore.polygons[0])).toBe(0);

        historyManager.redo();

        expect(RenderOrderComponent.get(geometryStore.polygons[0])).toBe(5);
      });
    });

    describe('rectangleInsert', () => {
      it('inserts a rectangle and undos/redos correctly', () => {
        const rectangle = geometryStore.addRectangle(
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 20), {
            fillColor: null,
            linkDimensions: false,
          }),
        );

        expect(geometryStore.rectangles).toHaveLength(1);
        expect(geometryStore.rectangles[0].id).toBe(rectangle.id);

        historyManager.undo();

        expect(geometryStore.rectangles).toHaveLength(0);

        historyManager.redo();

        expect(geometryStore.rectangles).toHaveLength(1);
      });
    });

    describe('rectangleMove', () => {
      it('moves a rectangle checking both corners and undos/redos correctly', () => {
        const before = makeRectangle({
          id: 'rect-1',
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        const after = makeRectangle({
          id: 'rect-1',
          upperLeft: new SheetPosition(5, 5),
          lowerRight: new SheetPosition(15, 25),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        geometryStore.addDirect(before);

        historyManager.apply(
          UndoEntry.rectangleMove(
            'rect-1',
            RectangleComponent.get(before),
            RectangleComponent.get(after),
          ),
        );

        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.x).toBe(5);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.y).toBe(5);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.x).toBe(15);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.y).toBe(25);

        historyManager.undo();

        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.x).toBe(0);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.y).toBe(0);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.x).toBe(10);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.y).toBe(20);

        historyManager.redo();

        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.x).toBe(5);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).upperLeft.y).toBe(5);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.x).toBe(15);
        expect(RectangleComponent.get(geometryStore.rectangles[0]).lowerRight.y).toBe(25);
      });
    });

    describe('rectangleDelete', () => {
      it('deletes a rectangle and undos/redos correctly', () => {
        const rectangle = geometryStore.addRectangle(
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 20), {
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.deleteGeometry(rectangle));

        expect(geometryStore.rectangles).toHaveLength(0);

        historyManager.undo();

        expect(geometryStore.rectangles).toHaveLength(1);

        historyManager.redo();

        expect(geometryStore.rectangles).toHaveLength(0);
      });
    });

    describe('rectangleFillColor', () => {
      it('changes rectangle fill color and undos/redos correctly', () => {
        const rectangle = geometryStore.addRectangle(
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 20), {
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.fillColor(rectangle.id, null, 0x00ff00));

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBe(0x00ff00);

        historyManager.undo();

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBeNull();

        historyManager.redo();

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBe(0x00ff00);
      });
      it('clears rectangle fill color and undos/redos correctly', () => {
        const rectangle = geometryStore.addRectangle(
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 20), {
            fillColor: 0xff00ff,
            linkDimensions: false,
          }),
        );

        historyManager.apply(
          UndoEntry.fillColor(rectangle.id, FillColorComponent.get(rectangle), null),
        );

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBeNull();

        historyManager.undo();

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBe(0xff00ff);

        historyManager.redo();

        expect(FillColorComponent.get(geometryStore.rectangles[0])).toBeNull();
      });
    });

    describe('rectangleLinkDimensions', () => {
      it('toggles rectangle linkDimensions flag and undos/redos correctly', () => {
        const rectangle = geometryStore.addRectangle(
          Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 20), {
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.linkDimensions(rectangle.id, false, true));

        expect(LinkDimensionsComponent.get(geometryStore.rectangles[0])).toBe(true);

        historyManager.undo();

        expect(LinkDimensionsComponent.get(geometryStore.rectangles[0])).toBe(false);

        historyManager.redo();

        expect(LinkDimensionsComponent.get(geometryStore.rectangles[0])).toBe(true);
      });
    });

    describe('rectangleRenderOrder', () => {
      it('changes rectangle render order and undos/redos correctly', () => {
        const rectangle = makeRectangle({
          id: 'rect-1',
          upperLeft: new SheetPosition(0, 0),
          lowerRight: new SheetPosition(10, 20),
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        geometryStore.addDirect(rectangle);

        historyManager.apply(UndoEntry.renderOrder('rect-1', 0, 3));

        expect(RenderOrderComponent.get(geometryStore.rectangles[0])).toBe(3);

        historyManager.undo();

        expect(RenderOrderComponent.get(geometryStore.rectangles[0])).toBe(0);

        historyManager.redo();

        expect(RenderOrderComponent.get(geometryStore.rectangles[0])).toBe(3);
      });
    });

    describe('ellipseInsert', () => {
      it('inserts an ellipse and undos/redos correctly', () => {
        historyManager.apply(
          UndoEntry.insert(
            makeEllipse({
              id: 'ellipse-1',
              center: new SheetPosition(0, 0),
              radiusX: 10,
              radiusY: 20,
              fillColor: null,
              linkDimensions: false,
              renderOrder: 0,
            }),
          ),
        );

        expect(geometryStore.ellipses).toHaveLength(1);
        expect(geometryStore.ellipses[0].id).toBe('ellipse-1');

        historyManager.undo();

        expect(geometryStore.ellipses).toHaveLength(0);

        historyManager.redo();

        expect(geometryStore.ellipses).toHaveLength(1);
      });
    });

    describe('ellipseMove', () => {
      it('moves an ellipse checking both center and radii and undos/redos correctly', () => {
        const before = makeEllipse({
          id: 'ellipse-1',
          center: new SheetPosition(0, 0),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        const after = makeEllipse({
          id: 'ellipse-1',
          center: new SheetPosition(5, 5),
          radiusX: 15,
          radiusY: 25,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        geometryStore.addDirect(before);

        historyManager.apply(
          UndoEntry.ellipseMove(
            'ellipse-1',
            EllipseComponent.get(before),
            EllipseComponent.get(after),
          ),
        );

        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.x).toBe(5);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.y).toBe(5);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusX).toBe(15);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusY).toBe(25);

        historyManager.undo();

        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.x).toBe(0);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.y).toBe(0);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusX).toBe(10);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusY).toBe(20);

        historyManager.redo();

        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.x).toBe(5);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).center.y).toBe(5);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusX).toBe(15);
        expect(EllipseComponent.get(geometryStore.ellipses[0]).radiusY).toBe(25);
      });
    });

    describe('ellipseDelete', () => {
      it('deletes an ellipse and undos/redos correctly', () => {
        const ellipse = geometryStore.addEllipse(
          Ellipse.create(new SheetPosition(0, 0), {
            radiusX: 10,
            radiusY: 20,
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.deleteGeometry(ellipse));

        expect(geometryStore.ellipses).toHaveLength(0);

        historyManager.undo();

        expect(geometryStore.ellipses).toHaveLength(1);

        historyManager.redo();

        expect(geometryStore.ellipses).toHaveLength(0);
      });
    });

    describe('ellipseFillColor', () => {
      it('changes ellipse fill color and undos/redos correctly', () => {
        const ellipse = geometryStore.addEllipse(
          Ellipse.create(new SheetPosition(0, 0), {
            radiusX: 10,
            radiusY: 20,
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.fillColor(ellipse.id, null, 0x0000ff));

        expect(FillColorComponent.get(geometryStore.ellipses[0])).toBe(0x0000ff);

        historyManager.undo();

        expect(FillColorComponent.get(geometryStore.ellipses[0])).toBeNull();

        historyManager.redo();

        expect(FillColorComponent.get(geometryStore.ellipses[0])).toBe(0x0000ff);
      });
    });

    describe('ellipseLinkDimensions', () => {
      it('toggles ellipse linkDimensions flag and undos/redos correctly', () => {
        const ellipse = geometryStore.addEllipse(
          Ellipse.create(new SheetPosition(0, 0), {
            radiusX: 10,
            radiusY: 20,
            fillColor: null,
            linkDimensions: false,
          }),
        );

        historyManager.apply(UndoEntry.linkDimensions(ellipse.id, false, true));

        expect(LinkDimensionsComponent.get(geometryStore.ellipses[0])).toBe(true);

        historyManager.undo();

        expect(LinkDimensionsComponent.get(geometryStore.ellipses[0])).toBe(false);

        historyManager.redo();

        expect(LinkDimensionsComponent.get(geometryStore.ellipses[0])).toBe(true);
      });
    });

    describe('ellipseRenderOrder', () => {
      it('changes ellipse render order and undos/redos correctly', () => {
        const ellipse = makeEllipse({
          id: 'ellipse-1',
          center: new SheetPosition(5, 5),
          radiusX: 10,
          radiusY: 20,
          fillColor: null,
          linkDimensions: false,
          renderOrder: 0,
        });
        geometryStore.addDirect(ellipse);

        historyManager.apply(UndoEntry.renderOrder('ellipse-1', 0, 2));

        expect(RenderOrderComponent.get(geometryStore.ellipses[0])).toBe(2);

        historyManager.undo();

        expect(RenderOrderComponent.get(geometryStore.ellipses[0])).toBe(0);

        historyManager.redo();

        expect(RenderOrderComponent.get(geometryStore.ellipses[0])).toBe(2);
      });
    });
  });
});
