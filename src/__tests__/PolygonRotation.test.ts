import { Entity, GeometryComponent, Polygon } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { BoundingBox } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';

function point(x: number, y: number) {
  return { type: 'point' as const, point: new SheetPosition(x, y) };
}

describe('polygon rotation support', () => {
  let geometryStore: GeometryStore;

  beforeEach(() => {
    const historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('creates polygons with a zero rotation component', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([point(0, 0), point(4, 0), point(4, 2)], { closed: true }),
    );
    const withRotation = geometryStore.getByIdWithComponent(polygon.id, RotationComponent)!;
    expect(RotationComponent.get(withRotation).angle.toDegrees().magnitude).toBeCloseTo(0);
  });

  it('projects rotated polygon segments, key points, and bounds through the render transform', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([point(10, 10), point(14, 10), point(14, 12), point(10, 12)], {
        closed: true,
      }),
    );
    geometryStore.updateByIdWithComponent(polygon.id, RotationComponent, (geometry) =>
      RotationComponent.update(geometry, { angle: Angle.degrees(90) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      polygon.id,
      GeometryComponent,
      AnchorPointComponent,
      RotationComponent,
    )!;

    const rendered = PolygonData.renderedSegments(geometry).map((segment) => segment.point);
    expect(rendered.map((p) => `${p.x},${p.y}`)).toEqual(['10,10', '10,14', '8,14', '8,10']);

    const projectedKeyPoints = GeometryComponent.keyPoints(geometry).perimeter.map((p) =>
      p.toSheet(geometry),
    );
    const keyPointBounds = BoundingBox.fromPoints(projectedKeyPoints);
    expect(keyPointBounds.position.x).toBeCloseTo(8);
    expect(keyPointBounds.position.y).toBeCloseTo(10);
    expect(keyPointBounds.width).toBeCloseTo(2);
    expect(keyPointBounds.height).toBeCloseTo(4);

    const renderedBounds = Entity.boundingBoxInSheet(geometry);
    expect(renderedBounds.position.x).toBeCloseTo(8);
    expect(renderedBounds.position.y).toBeCloseTo(10);
    expect(renderedBounds.width).toBeCloseTo(2);
    expect(renderedBounds.height).toBeCloseTo(4);

    const orientedBounds = Entity.orientedBoundingBoxInSheet(geometry);
    expect(orientedBounds.angleDegrees).toBeCloseTo(90);
    expect(orientedBounds.width).toBeCloseTo(4);
    expect(orientedBounds.height).toBeCloseTo(2);
  });
});
