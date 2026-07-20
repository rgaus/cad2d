import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  type CubicBezierSegment,
  GeometryComponent,
  PointSegment,
  Polygon,
  Rectangle,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { FilletFilter } from '@/lib/entity/filters/fillet';
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
});
