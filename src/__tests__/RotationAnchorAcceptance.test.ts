import {
  ConstraintEndpoint,
  Datum,
  Entity,
  GeometryComponent,
  LinearConstraint,
  Polygon,
  Rectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Angle } from '@/lib/units/angle';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number) {
  return { type: 'point' as const, point: new SheetPosition(x, y) };
}

describe('rotation + anchor acceptance', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('computes dynamic mirror fill state from rendered endpoints, not raw endpoints', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(0, 0), makePoint(4, 4), makePoint(0, 10)], { closed: false }),
    );
    geometryStore.updateByIdWithComponent(polygon.id, AnchorPointComponent, (g) =>
      AnchorPointComponent.update(g, {
        keyPoint: 'boundingBoxUpperLeft',
        offset: new SheetPosition(5, 0),
      }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      polygon.id,
      GeometryComponent,
      AnchorPointComponent,
    )!;

    const rendered = PolygonData.renderedSegments(geometry);
    expect(rendered[0].point.x).toBeCloseTo(-5);
    expect(rendered.at(-1)!.point.x).toBeCloseTo(-5);

    const filterData = {
      type: 'mirror' as const,
      geometryId: polygon.id,
      pointA: new SheetPosition(-5, -10),
      pointB: new SheetPosition(-5, 20),
    };
    expect(MirrorFilter.computeDynamicFillState(geometry, filterData)).toBe('filled');

    const rawLineFilterData = {
      ...filterData,
      pointA: new SheetPosition(0, -10),
      pointB: new SheetPosition(0, 20),
    };
    expect(MirrorFilter.computeDynamicFillState(geometry, rawLineFilterData)).toBe('unchanged');
  });

  it('reconstrains a rotated + anchored rectangle with an already satisfied center constraint', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(10, 10), new SheetPosition(14, 12)),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, AnchorPointComponent, (g) =>
      AnchorPointComponent.update(g, {
        keyPoint: 'center',
        offset: new SheetPosition(1, -1),
      }),
    );
    geometryStore.updateByIdWithComponent(rectangle.id, RotationComponent, (g) =>
      RotationComponent.update(g, { angle: Angle.degrees(30) }),
    );
    const geometry = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
      RotationComponent,
    )!;
    const center = GeometryComponent.keyPoints(geometry).extras.center.toSheet(geometry);
    const datum = geometryStore.addOrdered(
      ID_PREFIXES.datum,
      Datum.create(new SheetPosition(center.x + 3, center.y)),
    );
    geometryStore.add(
      ID_PREFIXES.constraint,
      LinearConstraint.create(
        ConstraintEndpoint.lockedToRectangle(rectangle.id, 'center'),
        ConstraintEndpoint.lockedToDatum(datum.id),
        Length.centimeters(3),
      ),
    );

    const beforeRaw = GeometryComponent.get(geometry);
    if (beforeRaw.type !== 'rectangle') {
      throw new Error('Expected rectangle');
    }
    const beforeOrigin = { ...beforeRaw.origin };
    const beforeWidth = beforeRaw.width;
    const beforeHeight = beforeRaw.height;
    const beforeAnchor = { ...AnchorPointComponent.get(geometry) };
    const beforeAngle = RotationComponent.get(geometry).angle.toDegrees().magnitude;

    expect(() => geometryStore.reconstrain('cm', [])).not.toThrow();

    const after = geometryStore.getByIdWithComponents(
      rectangle.id,
      GeometryComponent,
      AnchorPointComponent,
      RotationComponent,
    )!;
    const afterRaw = GeometryComponent.get(after);
    if (afterRaw.type !== 'rectangle') {
      throw new Error('Expected rectangle');
    }
    expect(afterRaw.origin.x).toBeCloseTo(beforeOrigin.x);
    expect(afterRaw.origin.y).toBeCloseTo(beforeOrigin.y);
    expect(afterRaw.width).toBeCloseTo(beforeWidth);
    expect(afterRaw.height).toBeCloseTo(beforeHeight);
    expect(AnchorPointComponent.get(after).offset).toMatchObject({
      x: beforeAnchor.offset.x,
      y: beforeAnchor.offset.y,
    });
    expect(RotationComponent.get(after).angle.toDegrees().magnitude).toBeCloseTo(beforeAngle);
  });

  it('keeps polygon OBB angle and computed bounds consistent for a rotated polygon', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(0, 0), makePoint(10, 0), makePoint(0, 10)], { closed: true }),
    );
    geometryStore.updateById(polygon.id, (g) => ({
      ...g,
      components: { ...g.components, ...RotationComponent.create(Angle.degrees(90)) },
    }));
    const geometry = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;

    const oriented = GeometryComponent.orientedBoundingBox(geometry);
    expect(oriented.angleDegrees).toBe(90);
    expect(oriented.position.x).toBeCloseTo(0);
    expect(oriented.position.y).toBeCloseTo(0);
    expect(oriented.width).toBeCloseTo(10);
    expect(oriented.height).toBeCloseTo(10);

    const renderedBounds = Entity.boundingBoxInSheet(geometry);
    expect(renderedBounds.position.x).toBeCloseTo(-10);
    expect(renderedBounds.position.y).toBeCloseTo(0);
    expect(renderedBounds.width).toBeCloseTo(10);
    expect(renderedBounds.height).toBeCloseTo(10);
  });

  it('documents that curve control points do not extend the polygon bounds', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          makePoint(0, 0),
          {
            type: 'arc-quadratic',
            point: new SheetPosition(10, 0),
            controlPoint: new SheetPosition(5, 20),
          },
        ],
        { closed: false },
      ),
    );
    const geometry = geometryStore.getByIdWithComponent(polygon.id, GeometryComponent)!;

    const bounds = PolygonData.boundingBox(geometry as Entity<GeometryComponent<PolygonData>>);
    expect(bounds.position.x).toBeCloseTo(0);
    expect(bounds.position.y).toBeCloseTo(0);
    expect(bounds.width).toBeCloseTo(10);
    expect(bounds.height).toBeCloseTo(0);
  });
});
