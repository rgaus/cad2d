import {
  AnchorPointComponent,
  Entity,
  GeometryComponent,
  type PointSegment,
  Polygon,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { PolygonData, PolygonSegment } from '@/lib/entity/geometry/polygon';
import { UndoEntry } from '@/lib/history/types';
import { BoundingBox } from '@/lib/math';
import { parseSvg } from '@/lib/serialization/deserialize';
import { serializePolygon } from '@/lib/serialization/serialize';
import { Sheet } from '@/lib/sheet/Sheet';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { GeometryRelativeSheetPosition, type Position, SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function polygonById(geometryStore: GeometryStore, id: string) {
  const polygon = geometryStore.getByIdWithComponent(id, GeometryComponent);
  if (!polygon || !GeometryComponent.isPolygon(polygon)) {
    throw new Error(`expected polygon ${id}`);
  }
  return polygon;
}

function rawPoints(polygon: Entity<GeometryComponent<PolygonData>>) {
  return PolygonData.rawSegments(polygon).map((segment) => segment.point);
}

function localPoints(polygon: Entity<GeometryComponent<PolygonData>>) {
  return GeometryComponent.get(polygon).points.map((segment) => segment.point);
}

function pointPairs(points: Array<Position>) {
  return points.map((point) => [point.x, point.y]);
}

describe('polygon stable local storage', () => {
  let sheet: Sheet;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    sheet = Sheet.a4();
    geometryStore = sheet.geometryStore;
  });

  it('stores a stable position plus local GRS points', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30)], {
        closed: false,
        fillColor: null,
      }),
    );
    const entity = polygonById(geometryStore, polygon.id);
    const data = GeometryComponent.get(entity);

    expect(data.position).toEqual(new SheetPosition(10, 20));
    expect(pointPairs(localPoints(entity))).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(
      data.points.every((segment) => segment.point instanceof GeometryRelativeSheetPosition),
    ).toBe(true);
    expect(pointPairs(rawPoints(entity))).toEqual([
      [10, 20],
      [20, 20],
      [20, 30],
    ]);
  });

  it('translate preserves absolute geometry while moving the stable position', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30)], {
        closed: false,
        fillColor: null,
      }),
    );
    const entity = polygonById(geometryStore, polygon.id);
    const beforeRaw = pointPairs(rawPoints(entity));
    const translated = PolygonData.translate(
      entity,
      (point) => new SheetPosition(point.x + 5, point.y - 3),
    );
    const translatedData = GeometryComponent.get(translated);

    expect(translatedData.position).toEqual(new SheetPosition(15, 17));
    expect(pointPairs(localPoints(translated))).toEqual(pointPairs(localPoints(entity)));
    expect(pointPairs(rawPoints(translated))).toEqual(beforeRaw.map(([x, y]) => [x + 5, y - 3]));
  });

  it('reports raw key points, bounding boxes and centroid in local space', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30), makePoint(10, 30)], {
        closed: true,
      }),
    );
    const entity = polygonById(geometryStore, polygon.id);
    const keyPoints = PolygonData.rawKeyPoints(entity);

    expect(keyPoints.perimeter.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(keyPoints.extras.boundingBoxUpperLeft).toEqual(new GeometryRelativeSheetPosition(0, 0));
    expect(keyPoints.extras.centroid.x).toBeCloseTo(5);
    expect(keyPoints.extras.centroid.y).toBeCloseTo(5);

    const bbox = PolygonData.boundingBox(entity);
    expect(bbox.position.x).toBeCloseTo(0);
    expect(bbox.position.y).toBeCloseTo(0);
    expect(bbox.width).toBeCloseTo(10);
    expect(bbox.height).toBeCloseTo(10);

    const renderedSegments = PolygonData.renderedSegments(entity);
    const renderedBounds = BoundingBox.fromPoints(renderedSegments.map((segment) => segment.point));
    expect(renderedBounds.position.x).toBeCloseTo(10);
    expect(renderedBounds.position.y).toBeCloseTo(20);
    expect(renderedBounds.width).toBeCloseTo(10);
    expect(renderedBounds.height).toBeCloseTo(10);
  });

  it('labels clockwise polygon key points in stored point order', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(10, 30), makePoint(20, 30), makePoint(20, 20)], {
        closed: true,
      }),
    );
    const entity = polygonById(geometryStore, polygon.id);

    const keyPoints = PolygonData.rawKeyPoints(entity);

    expect(keyPoints.perimeter.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ]);
    expect(keyPoints.perimeterLabels).toEqual(['Point 1', 'Point 2', 'Point 3', 'Point 4']);
    expect(keyPoints.perimeter.map((point) => point.toSheet(entity))).toEqual([
      new SheetPosition(10, 20),
      new SheetPosition(10, 30),
      new SheetPosition(20, 30),
      new SheetPosition(20, 20),
    ]);
  });

  it('serializes polygons using raw absolute segments and round-trips', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30), makePoint(10, 20)], {
        closed: true,
      }),
    );
    const entity = polygonById(geometryStore, polygon.id);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${serializePolygon(entity as Polygon)}</svg>`;
    const parsed = parseSvg(svg, () => 'generated');
    expect(parsed.polygons).toHaveLength(1);

    expect(pointPairs(rawPoints(parsed.polygons[0]))).toEqual(pointPairs(rawPoints(entity)));
  });

  it('preserves arcs and control points in both raw and rendered projections', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          makePoint(10, 20),
          {
            type: 'arc-quadratic',
            point: new SheetPosition(20, 20),
            controlPoint: new SheetPosition(15, 25),
          },
          {
            type: 'arc-cubic',
            point: new SheetPosition(30, 20),
            controlPointA: new SheetPosition(22, 28),
            controlPointB: new SheetPosition(28, 28),
          },
        ],
        { closed: false, fillColor: null },
      ),
    );
    const entity = polygonById(geometryStore, polygon.id);
    geometryStore.updateByIdWithComponent(entity.id, AnchorPointComponent, (geometry) =>
      AnchorPointComponent.update(geometry, {
        keyPoint: 'boundingBoxUpperLeft',
        offset: new SheetPosition(2, 3),
      }),
    );
    geometryStore.updateByIdWithComponent(entity.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
    );
    const transformed = polygonById(geometryStore, polygon.id);
    const transform = Entity.generateRenderTransformFunction(transformed);

    const raw = PolygonData.rawSegments(transformed);
    const rendered = PolygonData.renderedSegments(transformed);
    expect(raw[1].type).toBe('arc-quadratic');
    expect(raw[2].type).toBe('arc-cubic');

    for (let i = 0; i < raw.length; i += 1) {
      const expected = transform(raw[i].point);
      expect(rendered[i].point.x).toBeCloseTo(expected.x);
      expect(rendered[i].point.y).toBeCloseTo(expected.y);
      const expectedSegment = PolygonSegment.transform(raw[i], transform);
      expect(rendered[i].point.x).toBeCloseTo(expectedSegment.point.x);
      expect(rendered[i].point.y).toBeCloseTo(expectedSegment.point.y);
    }
  });

  it('history replay preserves position and local points across undo/redo', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30)], {
        closed: false,
        fillColor: null,
      }),
    );
    const before = polygonById(geometryStore, polygon.id);
    const beforeData = GeometryComponent.get(before);
    const beforeRaw = pointPairs(rawPoints(before));

    sheet.historyManager.apply(UndoEntry.polygonTranslate(polygon.id, 4, -2));
    const moved = polygonById(geometryStore, polygon.id);
    expect(GeometryComponent.get(moved).position).toEqual(new SheetPosition(14, 18));
    expect(pointPairs(localPoints(moved))).toEqual(pointPairs(localPoints(before)));
    expect(pointPairs(rawPoints(moved))).toEqual(beforeRaw.map(([x, y]) => [x + 4, y - 2]));
    expect(PolygonData.equals(before, moved)).toBe(false);

    sheet.historyManager.undo();
    const undone = polygonById(geometryStore, polygon.id);
    expect(GeometryComponent.get(undone).position).toEqual(beforeData.position);
    expect(pointPairs(localPoints(undone))).toEqual(
      pointPairs(beforeData.points.map((s) => s.point)),
    );

    sheet.historyManager.redo();
    const redone = polygonById(geometryStore, polygon.id);
    expect(GeometryComponent.get(redone).position).toEqual(new SheetPosition(14, 18));
    expect(pointPairs(localPoints(redone))).toEqual(pointPairs(localPoints(before)));
  });

  it('selection inspector displays rendered points and writes edits back to local points', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(10, 20), makePoint(20, 20), makePoint(20, 30)], {
        closed: false,
        fillColor: null,
      }),
    );
    geometryStore.updateByIdWithComponent(polygon.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
    );
    sheet.selectionManager.select(polygon.id);
    sheet.selectionInspectorManager.recomputeFields();

    const fields = sheet.selectionInspectorManager.fields;
    const pointsField = fields.find((field) => field.type === 'polygon-points');
    expect(pointsField).toBeDefined();
    if (!pointsField || pointsField.type !== 'polygon-points') {
      return;
    }

    const entity = polygonById(geometryStore, polygon.id);
    const rendered = PolygonData.renderedSegments(entity);
    expect(pointPairs(pointsField.value.points.map((segment) => segment.point))).toEqual(
      pointPairs(rendered.map((segment) => segment.point)),
    );

    const targetRenderedX = rendered[1].point.x + 5;
    const expectedLocal = new SheetPosition(
      targetRenderedX,
      rendered[1].point.y,
    ).toGeometryRelativeSheetPosition(entity);
    pointsField.handlers.onPointXChange?.(
      1,
      Length.fromSheetUnits(sheet.defaultUnit, targetRenderedX),
    );
    pointsField.handlers.onPointXBlur?.(1);

    const after = polygonById(geometryStore, polygon.id);
    const afterLocal = GeometryComponent.get(after).points[1].point;
    expect(afterLocal.x).toBeCloseTo(expectedLocal.x);
    expect(afterLocal.y).toBeCloseTo(expectedLocal.y);
    // The stored position stays stable while the local point moves.
    expect(GeometryComponent.get(after).position).toEqual(GeometryComponent.get(entity).position);
  });
});
