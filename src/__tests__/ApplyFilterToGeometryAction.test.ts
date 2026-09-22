import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  ConstraintEndpoint,
  type CubicBezierSegment,
  Ellipse,
  GeometryComponent,
  HorizontalConstraint,
  PointSegment,
  Polygon,
  Rectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { FillColorComponent } from '@/lib/entity/components/FillColorComponent';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { ChamferFilter } from '@/lib/entity/filters/chamfer';
import { FilletFilter } from '@/lib/entity/filters/fillet';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

describe('ApplyFilterToGeometryAction', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;

  beforeEach(() => {
    const sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  describe('Rectangle', () => {
    let rect: Rectangle;

    beforeEach(() => {
      rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      ) as Rectangle;
    });

    it('applies upperRight fillet to rectangle', async () => {
      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerRight',
          'upperRight',
          'upperLeft',
          Length.centimeters(20),
        ),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[2] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraintGeoms = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraintGeoms
          .filter((g) => ConstraintComponent.get(g).type === 'horizontal')
          .map((g) => {
            const c = ConstraintComponent.get(g);
            if (c.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(c)} point a not locked-polygon!`);
            }
            if (c.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(c)} point b not locked-polygon!`);
            }
            return `${c.pointA.pointIndex},${c.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['0,1', '3,4']);
      expect(
        constraintGeoms
          .filter((g) => ConstraintComponent.get(g).type === 'vertical')
          .map((g) => {
            const c = ConstraintComponent.get(g);
            if (c.pointA.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(c)} point a not locked-polygon!`);
            }
            if (c.pointB.type !== 'locked-polygon') {
              throw new Error(`Constraint ${JSON.stringify(c)} point b not locked-polygon!`);
            }
            return `${c.pointA.pointIndex},${c.pointB.pointIndex}`;
          })
          .sort(),
      ).toEqual(['2,3', '4,0']);
    });

    it('applies lowerRight fillet to rectangle', async () => {
      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'lowerRight',
          'upperRight',
          Length.centimeters(20),
        ),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('arc-cubic');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Polygon: UL -> UR -> split(100,80) -> arc -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(80);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      const arc = points[3] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(80);
      expect(arc.point.y).toBeCloseTo(100);

      expect(arc.controlPointA.x).toBeCloseTo(100, 2);
      expect(arc.controlPointA.y).toBeCloseTo(91.05, 2);
      expect(arc.controlPointB.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointB.y).toBeCloseTo(100);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraintGeoms = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'horizontal') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['0,1', '3,4']);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'vertical') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['1,2', '4,0']);
    });

    it('applies lowerLeft fillet to rectangle', async () => {
      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerRight',
          'lowerLeft',
          'upperLeft',
          Length.centimeters(20),
        ),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');
      expect(points[5].type).toBe('point');

      // Polygon: UL -> UR -> LR -> split(20,100) -> arc -> UL
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[3].point.x).toBeCloseTo(20);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[5].point.x).toBeCloseTo(0);
      expect(points[5].point.y).toBeCloseTo(0);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      const arc = points[4] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(0);
      expect(arc.point.y).toBeCloseTo(80);

      expect(arc.controlPointA.x).toBeCloseTo(8.95, 2);
      expect(arc.controlPointA.y).toBeCloseTo(100, 2);
      expect(arc.controlPointB.x).toBeCloseTo(0, 2);
      expect(arc.controlPointB.y).toBeCloseTo(91.05, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraintGeoms = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'horizontal') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['0,1', '2,3']);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'vertical') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['1,2', '4,0']);
    });

    it('applies upperLeft fillet to rectangle', async () => {
      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'upperLeft',
          'upperRight',
          Length.centimeters(20),
        ),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('arc-cubic');

      // Polygon: split(20,0) -> UR -> LR -> LL -> split(0,20) -> arc -> split(20,0) closed
      // Does NOT start at UL(0,0) — wrapping case shifts the polygon start
      expect(points[0].point.x).toBeCloseTo(20);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[2].point.x).toBeCloseTo(100);
      expect(points[2].point.y).toBeCloseTo(100);
      expect(points[3].point.x).toBeCloseTo(0);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(20);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      const arc = points[5] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(20);
      expect(arc.point.y).toBeCloseTo(0);

      expect(arc.controlPointA.x).toBeCloseTo(0, 2);
      expect(arc.controlPointA.y).toBeCloseTo(8.95, 2);
      expect(arc.controlPointB.x).toBeCloseTo(8.95, 2);
      expect(arc.controlPointB.y).toBeCloseTo(0, 2);

      // Make sure rectangle horizontal/vertical constraints are attached to the right indexes
      const constraintGeoms = geometryStore.findConstraintsByGeometryId(polygons[0].id);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'horizontal') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['0,1', '2,3']);
      expect(
        constraintGeoms
          .flatMap((g) => {
            const c = ConstraintComponent.get(g);
            if (c.type !== 'vertical') {
              return [];
            }
            if (c.pointA.type !== 'locked-polygon' || c.pointB.type !== 'locked-polygon') {
              return [];
            }
            return [`${c.pointA.pointIndex},${c.pointB.pointIndex}`];
          })
          .sort(),
      ).toEqual(['1,2', '3,4']);
    });

    it('applies two fillets sequentially to rectangle', async () => {
      // Create both filters on the same rectangle
      const filter1Id = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerRight',
          'upperRight',
          'upperLeft',
          Length.centimeters(20),
        ),
      ).id;
      const filter2Id = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'lowerRight',
          'upperRight',
          Length.centimeters(20),
        ),
      ).id;

      // Apply first filter (upperRight)
      selectionManager.select(filter1Id);
      await actionsManager.execute('apply-filter-to-geometry');

      let polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      let points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(6);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');
      expect(points[5].type).toBe('point');

      // Arc destination = splitB on the vertical edge (100, 20)
      const arcA = points[2] as CubicBezierSegment;
      expect(arcA.point.x).toBeCloseTo(100);
      expect(arcA.point.y).toBeCloseTo(20);

      expect(arcA.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arcA.controlPointA.y).toBeCloseTo(0, 2);
      expect(arcA.controlPointB.x).toBeCloseTo(100);
      expect(arcA.controlPointB.y).toBeCloseTo(8.95, 2);

      // Make sure filter2 was updated to point to newly created polygon
      const filter2 = geometryStore.getByIdWithComponent(filter2Id, FilterComponent)!;
      expect(FilterComponent.get(filter2).geometryId).toStrictEqual(polygons[0].id);
      expect((FilterComponent.get(filter2) as any).geometryType).toStrictEqual('polygon');

      // Apply second filter (lowerRight)
      selectionManager.deselect(filter1Id);
      selectionManager.select(filter2Id);
      await actionsManager.execute('apply-filter-to-geometry');

      polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      // After clicking the lower right corner, there should be another new arc added
      points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(7);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');
      expect(points[5].type).toBe('point');
      expect(points[6].type).toBe('point');

      const arcB = points[4] as CubicBezierSegment;
      expect(arcB.controlPointA.x).toBeCloseTo(100, 2);
      expect(arcB.controlPointA.y).toBeCloseTo(91.05, 2);
      expect(arcB.controlPointB.x).toBeCloseTo(91.05, 2);
      expect(arcB.controlPointB.y).toBeCloseTo(100);
    });
  });

  describe('Polygon', () => {
    it('applies fillet to polygon middle point', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
          closed: true,
        }),
      );
      const polygonId = geometryStore.listWithComponent(GeometryComponent)[0].id;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(polygonId, 0, 1, 2, Length.centimeters(20)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(5);

      // Point segments at indices 0,1,3,4,5
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-cubic');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('point');

      // Point positions: (0,0) -> split(80,0) -> arc -> (100,100) -> (0,0)
      expect(points[0].point.x).toBeCloseTo(0);
      expect(points[0].point.y).toBeCloseTo(0);
      expect(points[1].point.x).toBeCloseTo(80);
      expect(points[1].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(100);
      expect(points[3].point.y).toBeCloseTo(100);
      expect(points[4].point.x).toBeCloseTo(0);
      expect(points[4].point.y).toBeCloseTo(0);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[2] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);
    });

    it('applies fillet to polygon starting point (wrap)', async () => {
      geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [makePoint(100, 0), makePoint(100, 100), makePoint(0, 0), makePoint(100, 0)],
          { closed: true },
        ),
      );
      const polygonId = geometryStore.listWithComponent(GeometryComponent)[0].id;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(polygonId, 2, 0, 1, Length.centimeters(20)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polygons = geometryStore.listWithComponent(GeometryComponent);
      expect(polygons).toHaveLength(1);

      const points = GeometryComponent.get(polygons[0]).points;
      expect(points.length).toBe(5);

      // Point segments at indices 0,1,2,3
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('point');
      expect(points[3].type).toBe('point');
      expect(points[4].type).toBe('arc-cubic');

      // Point positions: UL -> split(80,0) -> arc -> LR -> LL -> UL
      expect(points[0].point.x).toBeCloseTo(100);
      expect(points[0].point.y).toBeCloseTo(20);
      expect(points[1].point.x).toBeCloseTo(100);
      expect(points[1].point.y).toBeCloseTo(100);
      expect(points[2].point.x).toBeCloseTo(0);
      expect(points[2].point.y).toBeCloseTo(0);
      expect(points[3].point.x).toBeCloseTo(80);
      expect(points[3].point.y).toBeCloseTo(0);
      expect(points[4].point.x).toBeCloseTo(100);
      expect(points[4].point.y).toBeCloseTo(20);
      expect(GeometryComponent.get(polygons[0]).closed).toBe(true);

      // Arc destination = splitB on the vertical edge (100, 20)
      const arc = points[4] as CubicBezierSegment;
      expect(arc.point.x).toBeCloseTo(100);
      expect(arc.point.y).toBeCloseTo(20);

      // Control points should be non-trivial (tangent to both edges)
      expect(arc.controlPointA.x).toBeCloseTo(91.05, 2);
      expect(arc.controlPointA.y).toBeCloseTo(0, 2);
      expect(arc.controlPointB.x).toBeCloseTo(100);
      expect(arc.controlPointB.y).toBeCloseTo(8.95, 2);
    });
  });

  describe('Mirror filter', () => {
    it('applies mirror to an ellipse, producing two ellipses', async () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 50), {
          radiusX: 20,
          radiusY: 10,
          fillColor: DEFAULT_COLOR,
        }),
      ) as Ellipse;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(ellipse.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const ellipses = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'ellipse');
      expect(ellipses).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const centers = ellipses.map((e) => {
        const c = GeometryComponent.get(e).center;
        return [c.x, c.y];
      });
      expect(centers).toContainEqual([50, 50]);
      expect(centers).toContainEqual([-50, 50]);
    });

    it('applies mirror to a rectangle, producing a rectangle and a mirrored closed polygon', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rect.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const shapes = geometryStore.listWithComponent(GeometryComponent);
      expect(shapes).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const rects = shapes.filter((g) => GeometryComponent.get(g).type === 'rectangle');
      const polys = shapes.filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(rects).toHaveLength(1);
      expect(polys).toHaveLength(1);
      expect(GeometryComponent.get(polys[0]).closed).toBe(true);
    });

    it('applies mirror to a closed polygon, producing two polygons', async () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(50, 100), makePoint(0, 0)], {
          closed: true,
        }),
      ) as Polygon;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(poly.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });

    it('collapses an open polygon mirrored over the mirror line into one closed polygon', async () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(50, 50), makePoint(0, 100)], {
          closed: false,
        }),
      ) as Polygon;
      const polygonId = poly.id;

      // Attach a horizontal constraint between the two on-mirror-line endpoints
      const constraintId = geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, 0),
          ConstraintEndpoint.lockedToPolygon(polygonId, 2),
        ),
      ).id;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(polygonId, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(1);
      expect(polys[0].id).toBe(polygonId);
      expect(GeometryComponent.get(polys[0]).closed).toBe(true);
      // Combined points: source (3) + reversed mirror (3)
      expect(GeometryComponent.get(polys[0]).points.length).toBe(6);
      // The merged closed polygon carries a fill color
      expect(FillColorComponent.getOptional(polys[0])).toBe(DEFAULT_COLOR);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      // Constraint locked to the old polygon points is removed
      expect(geometryStore.findConstraintsByGeometryId(polygonId)).toHaveLength(0);
      expect(geometryStore.getById(constraintId)).toBeNull();
    });
  });

  describe('Pattern filter (grid)', () => {
    it('applies a 2x2 grid to a rectangle, producing four rectangles', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(rect.id, new SheetPosition(0, 0), new SheetPosition(10, 10), {
          xRepeats: 2,
          yRepeats: 2,
        }),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const shapes = geometryStore.listWithComponent(GeometryComponent);
      expect(shapes).toHaveLength(4);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
      expect(shapes.every((g) => GeometryComponent.get(g).type === 'rectangle')).toBe(true);

      const upperLefts = shapes.map((g) => {
        const r = GeometryComponent.get(g);
        return [r.upperLeft.x, r.upperLeft.y];
      });
      expect(upperLefts).toContainEqual([0, 0]);
      expect(upperLefts).toContainEqual([10, 0]);
      expect(upperLefts).toContainEqual([0, 10]);
      expect(upperLefts).toContainEqual([10, 10]);
    });

    it('applies a 2x2 grid to an ellipse, producing four ellipses', async () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(5, 5), {
          radiusX: 2,
          radiusY: 2,
          fillColor: DEFAULT_COLOR,
        }),
      ) as Ellipse;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(ellipse.id, new SheetPosition(0, 0), new SheetPosition(10, 10), {
          xRepeats: 2,
          yRepeats: 2,
        }),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const ellipses = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'ellipse');
      expect(ellipses).toHaveLength(4);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });
  });

  describe('Pattern filter (radial)', () => {
    it('applies a radial pattern to a rectangle, producing a rectangle and three closed polygons', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(rect.id, new SheetPosition(40, 40), 100, { count: 4 }),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const shapes = geometryStore.listWithComponent(GeometryComponent);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);

      const rects = shapes.filter((g) => GeometryComponent.get(g).type === 'rectangle');
      const polys = shapes.filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(rects).toHaveLength(1);
      expect(polys).toHaveLength(3);
      expect(polys.every((p) => GeometryComponent.get(p).closed)).toBe(true);
    });

    it('applies a radial pattern to an ellipse, producing four ellipses', async () => {
      const ellipse = geometryStore.addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(new SheetPosition(50, 40), {
          radiusX: 5,
          radiusY: 5,
          fillColor: DEFAULT_COLOR,
        }),
      ) as Ellipse;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(ellipse.id, new SheetPosition(40, 40), 100, { count: 4 }),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const ellipses = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'ellipse');
      expect(ellipses).toHaveLength(4);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });

    it('collapses an open polygon whose endpoints touch the radial ring into one closed polygon', async () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -50), makePoint(0, 50), makePoint(-50, -50)], {
          closed: false,
        }),
      ) as Polygon;
      const polygonId = poly.id;

      const filterId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(polygonId, new SheetPosition(0, 0), 100, { count: 4 }),
      ).id;
      selectionManager.select(filterId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(1);
      expect(polys[0].id).toBe(polygonId);
      expect(GeometryComponent.get(polys[0]).closed).toBe(true);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });
  });

  describe('Multiple filters', () => {
    it('applies a fillet then a mirror on the same rectangle, resolving the mirror against the converted polygon', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      const filletFilterId = geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'upperLeft',
          'upperRight',
          Length.centimeters(20),
        ),
      ).id;
      const mirrorFilterId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rect.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;
      selectionManager.select(filletFilterId);
      selectionManager.select(mirrorFilterId);
      await actionsManager.execute('apply-filter-to-geometry');

      // Source rect became a filleted polygon, and the mirror copied it
      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(2);
      expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(0);
    });
  });

  describe('Filter migration on mirror/pattern apply', () => {
    it('duplicates a polygon-mode fillet onto a mirrored copy', async () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(50, 80), makePoint(0, 0)], {
          closed: true,
        }),
      ) as Polygon;

      geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(poly.id, 0, 1, 2, Length.centimeters(10)),
      );
      const mirrorId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(poly.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;

      selectionManager.select(mirrorId);
      await actionsManager.execute('apply-filter-to-geometry');

      // Source polygon + mirrored copy
      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(2);

      // Mirror deleted; source fillet retained + fillet duplicated onto the copy
      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(2);
      const copy = polys.find((p) => p.id !== poly.id)!;

      const copyFillet = filters.find((f) => FilterComponent.get(f).geometryId === copy.id);
      expect(copyFillet).toBeDefined();
      expect(filters.find((f) => FilterComponent.get(f).geometryId === poly.id)).toBeDefined();

      const copyData = FilterComponent.get(copyFillet!);
      if (copyData.type !== 'fillet' || copyData.geometryType !== 'polygon') {
        throw new Error('Expected polygon-mode fillet on the mirrored copy');
      }
      // Mirroring preserves point order, so the indices match the source fillet
      expect(copyData.pointCenterIndex).toBe(1);
      expect(copyData.pointAIndex).toBe(0);
      expect(copyData.pointBIndex).toBe(2);
    });

    it('converts a rectangle-mode chamfer onto a mirrored polygon copy', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      geometryStore.add(
        ID_PREFIXES.filter,
        ChamferFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'upperLeft',
          'upperRight',
          Length.centimeters(10),
        ),
      );
      const mirrorId = geometryStore.add(
        ID_PREFIXES.filter,
        MirrorFilter.create(rect.id, new SheetPosition(0, 0), new SheetPosition(0, 100)),
      ).id;

      selectionManager.select(mirrorId);
      await actionsManager.execute('apply-filter-to-geometry');

      // Source rect + mirrored polygon
      const shapes = geometryStore.listWithComponent(GeometryComponent);
      expect(shapes).toHaveLength(2);
      const copy = shapes.find((g) => GeometryComponent.get(g).type === 'polygon')!;

      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(2);

      const copyChamfer = filters.find((f) => FilterComponent.get(f).geometryId === copy.id);
      expect(copyChamfer).toBeDefined();
      const copyData = FilterComponent.get(copyChamfer!);
      if (copyData.type !== 'chamfer' || copyData.geometryType !== 'polygon') {
        throw new Error('Expected polygon-mode chamfer on the mirrored copy');
      }
      // Mirrored polygon corners are CCW: UL=0, UR=1, LR=2, LL=3
      expect(copyData.pointCenterIndex).toBe(0); // upperLeft
      expect(copyData.pointAIndex).toBe(3); // lowerLeft
      expect(copyData.pointBIndex).toBe(1); // upperRight
    });

    it('duplicates a rectangle-mode fillet onto each grid copy', async () => {
      const rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(10, 10), {
          fillColor: DEFAULT_COLOR,
        }),
      ) as Rectangle;

      geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnRectangle(
          rect.id,
          'lowerLeft',
          'upperLeft',
          'upperRight',
          Length.centimeters(1),
        ),
      );
      const gridId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(rect.id, new SheetPosition(0, 0), new SheetPosition(10, 10), {
          xRepeats: 2,
          yRepeats: 2,
        }),
      ).id;

      selectionManager.select(gridId);
      await actionsManager.execute('apply-filter-to-geometry');

      // 1 source rect + 3 copies
      const shapes = geometryStore.listWithComponent(GeometryComponent);
      expect(shapes).toHaveLength(4);

      // Source fillet + 3 duplicated fillets
      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(4);

      const copies = shapes.filter((g) => g.id !== rect.id);
      expect(copies).toHaveLength(3);
      for (const copy of copies) {
        const copyFillet = filters.find((f) => FilterComponent.get(f).geometryId === copy.id);
        expect(copyFillet).toBeDefined();
        const d = FilterComponent.get(copyFillet!);
        if (d.type !== 'fillet' || d.geometryType !== 'rectangle') {
          throw new Error('Expected rectangle-mode fillet on the grid copy');
        }
        expect(d.pointCenterKeyPoint).toBe('upperLeft');
        expect(d.pointAKeyPoint).toBe('lowerLeft');
        expect(d.pointBKeyPoint).toBe('upperRight');
      }
    });

    it('keeps a fillet attached to the merged polygon when a radial pattern combines it into one closed polygon', async () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(50, -50), makePoint(0, 50), makePoint(-50, -50)], {
          closed: false,
        }),
      ) as Polygon;
      const polygonId = poly.id;

      // Simulate the dynamic fill the pattern filter applies to this open polygon
      geometryStore.updateByIdDirect(polygonId, (old) =>
        FillColorComponent.update(old, DEFAULT_COLOR),
      );

      geometryStore.add(
        ID_PREFIXES.filter,
        FilletFilter.createOnPolygon(polygonId, 0, 1, 2, Length.centimeters(3)),
      );
      const radialId = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(polygonId, new SheetPosition(0, 0), 100, { count: 4 }),
      ).id;

      selectionManager.select(radialId);
      await actionsManager.execute('apply-filter-to-geometry');

      const polys = geometryStore
        .listWithComponent(GeometryComponent)
        .filter((g) => GeometryComponent.get(g).type === 'polygon');
      expect(polys).toHaveLength(1);
      expect(polys[0].id).toBe(polygonId);
      expect(GeometryComponent.get(polys[0]).closed).toBe(true);

      // The fillet survives, still attached to the merged polygon
      const fillets = geometryStore
        .listWithComponent(FilterComponent)
        .filter((f) => FilterComponent.get(f).geometryId === polygonId);
      expect(fillets).toHaveLength(1);
    });
  });
});
