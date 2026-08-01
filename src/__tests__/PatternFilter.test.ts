import { FrameComponent, type Id } from '@/lib/entity';
import { Polygon } from '@/lib/entity';
import { Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { PatternFilter, PatternFilterData } from '@/lib/entity/filters/pattern';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SheetPosition } from '@/lib/viewport/types';

function makeStore(): { store: GeometryStore; history: HistoryManager } {
  const history = new HistoryManager();
  const store = new GeometryStore(history);
  history.setGeometryStore(store);
  return { store, history };
}

describe('PatternFilter', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
  });

  describe('createGrid', () => {
    it('creates a grid template with FilterComponent and FrameComponent', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(2, 4), new SheetPosition(8, 10)),
      );

      const filterData = FilterComponent.get(filter);
      expect(filterData.type).toBe('pattern');
      expect(filterData.mode).toBe('grid');
      expect(filterData.geometryId).toBe(geometry.id);
      expect(filterData.xRepeats).toBe(2);
      expect(filterData.yRepeats).toBe(2);

      const frameData = FrameComponent.get(filter);
      expect(frameData).toBeDefined();
      expect(frameData.upperLeft.x).toBeCloseTo(2);
      expect(frameData.upperLeft.y).toBeCloseTo(4);
      expect(frameData.lowerRight.x).toBeCloseTo(8);
      expect(frameData.lowerRight.y).toBeCloseTo(10);
    });

    it('creates a grid template with custom repeat counts', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(0, 0), new SheetPosition(10, 10), {
          xRepeats: 3,
          yRepeats: 5,
        }),
      );

      const data = FilterComponent.get(filter);
      expect(data.xRepeats).toBe(3);
      expect(data.yRepeats).toBe(5);
    });
  });

  describe('createRadial', () => {
    it('creates a radial template with FilterComponent', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 3),
      );

      const data = FilterComponent.get(filter);
      expect(data.type).toBe('pattern');
      expect(data.mode).toBe('radial');
      expect(data.geometryId).toBe(geometry.id);
      expect(data.center.x).toBeCloseTo(5);
      expect(data.center.y).toBeCloseTo(5);
      expect(data.radius).toBeCloseTo(3);
      expect(data.repeats.type).toBe('count');
      expect(data.repeats.count).toBe(4);
    });

    it('creates a radial template with custom repeat count', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 5, { count: 6 }),
      );

      const data = FilterComponent.get(filter);
      expect(data.repeats.count).toBe(6);
    });
  });

  describe('getRadialCornerPoints', () => {
    it('computes left and right corner points for 4 repeats (90-degree slices)', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(0, 0), 10, { count: 4 }),
      );
      const filterData = FilterComponent.get(filter);

      const [left, right] = PatternFilter.getRadialCornerPoints(filterData);

      // 4 repeats = 90 deg slices, half-angle = 45 deg
      // tan(45) = 1, rightSideSlope = 1, leftSideSlope = -1
      // topLineIntercept = (0, -10)
      // left side (slope -1): y = -x + 0 → intersects y = -10 at x = 10
      // right side (slope 1): y = x + 0 → intersects y = -10 at x = -10
      expect(left.x).toBeCloseTo(10, 5);
      expect(left.y).toBeCloseTo(-10, 5);
      expect(right.x).toBeCloseTo(-10, 5);
      expect(right.y).toBeCloseTo(-10, 5);
    });

    it('works with an offset center', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const filter = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 3), 10, { count: 4 }),
      );
      const filterData = FilterComponent.get(filter);

      const [left, right] = PatternFilter.getRadialCornerPoints(filterData);

      // topLineIntercept = (5, -7)
      // left side (slope -1 through (5,3)): y = -x + 8 → intersects y = -7 at x = 15
      // right side (slope 1 through (5,3)): y = x - 2 → intersects y = -7 at x = -5
      expect(left.x).toBeCloseTo(15, 5);
      expect(left.y).toBeCloseTo(-7, 5);
      expect(right.x).toBeCloseTo(-5, 5);
      expect(right.y).toBeCloseTo(-7, 5);
    });
  });

  describe('translate', () => {
    it('translates grid filter frame via FrameComponent', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const entity = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );

      const result = PatternFilter.translate(entity, (p) => new SheetPosition(p.x + 5, p.y + 5));

      const frame = FrameComponent.get(result);
      expect(frame.upperLeft.x).toBeCloseTo(5);
      expect(frame.upperLeft.y).toBeCloseTo(5);
      expect(frame.lowerRight.x).toBeCloseTo(15);
      expect(frame.lowerRight.y).toBeCloseTo(15);
    });

    it('translates radial filter center', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const entity = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 3),
      );

      const result = PatternFilter.translate(entity, (p) => new SheetPosition(p.x + 10, p.y + 20));

      const filter = FilterComponent.get(result);
      if (filter.type !== 'pattern' || filter.mode !== 'radial') {
        throw new Error('Expected radial pattern filter');
      }
      expect(filter.center.x).toBeCloseTo(15);
      expect(filter.center.y).toBeCloseTo(25);
      expect(filter.radius).toBeCloseTo(3);
    });
  });

  describe('equals', () => {
    it('returns true for identical grid filters', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(1, 2), new SheetPosition(10, 20), {
          xRepeats: 3,
          yRepeats: 5,
        }),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(1, 2), new SheetPosition(10, 20), {
          xRepeats: 3,
          yRepeats: 5,
        }),
      );

      expect(PatternFilter.equals(a, b)).toBe(true);
    });

    it('returns false when grid repeat counts differ', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );
      const a = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(1, 2), new SheetPosition(10, 20), {
          xRepeats: 3,
          yRepeats: 5,
        }),
      ) as any;
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(1, 2), new SheetPosition(10, 20), {
          xRepeats: 4,
          yRepeats: 5,
        }),
      ) as any;

      expect(PatternFilter.equals(a, b)).toBe(false);
    });

    it('returns false when frame corners differ', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );

      const a = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(1, 2), new SheetPosition(10, 20)),
      ) as any;
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(5, 2), new SheetPosition(10, 20)),
      ) as any;

      expect(PatternFilter.equals(a, b)).toBe(false);
    });

    it('returns true for identical radial filters', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );

      const a = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 10, { count: 4 }),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 10, { count: 4 }),
      );

      expect(PatternFilter.equals(a, b)).toBe(true);
    });

    it('returns false when radial radius differs', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );

      const a = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 10),
      );
      const b = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 20),
      );

      expect(PatternFilter.equals(a, b)).toBe(false);
    });

    it('returns false for different modes', () => {
      const geometry = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(5, 5)),
      );

      const grid = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createGrid(geometry.id, new SheetPosition(0, 0), new SheetPosition(10, 10)),
      );
      const radial = geometryStore.add(
        ID_PREFIXES.filter,
        PatternFilter.createRadial(geometry.id, new SheetPosition(5, 5), 10),
      );

      expect(PatternFilter.equals(grid, radial)).toBe(false);
    });
  });

  describe('computeDynamicFillState', () => {
    it('returns unchanged for closed polygons', () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(10, 0) },
            { type: 'point', point: new SheetPosition(10, 10) },
          ],
          { closed: true },
        ),
      );

      const filterData: PatternFilterData = {
        type: 'pattern',
        mode: 'radial',
        geometryId: poly.id,
        center: new SheetPosition(5, 5),
        radius: 10,
        repeats: { type: 'count', count: 4 },
      };

      const result = PatternFilter.computeDynamicFillState(poly, filterData);
      expect(result).toBe('unchanged');
    });

    it('returns filled when open polygon endpoints touch both radial edges', () => {
      // 4 repeats at center (5,5), radius 10
      // left corner = (15, -5), right corner = (-5, -5)
      // First point on left edge (through (5,5)-(15,-5): y = -x+10), last on right
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(15, -5) },
            { type: 'point', point: new SheetPosition(5, 5) },
            { type: 'point', point: new SheetPosition(-5, -5) },
          ],
          { closed: false },
        ),
      );

      const filterData: PatternFilterData = {
        type: 'pattern',
        mode: 'radial',
        geometryId: poly.id,
        center: new SheetPosition(5, 5),
        radius: 10,
        repeats: { type: 'count', count: 4 },
      };

      const result = PatternFilter.computeDynamicFillState(poly, filterData);
      expect(result).toBe('filled');
    });

    it('returns unchanged when endpoints do not touch radial edges', () => {
      // Points far above the pie slice, not touching any edges
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(7, -20) },
            { type: 'point', point: new SheetPosition(5, 5) },
            { type: 'point', point: new SheetPosition(3, -20) },
          ],
          { closed: false },
        ),
      );

      const filterData: PatternFilterData = {
        type: 'pattern',
        mode: 'radial',
        geometryId: poly.id,
        center: new SheetPosition(5, 5),
        radius: 10,
        repeats: { type: 'count', count: 4 },
      };

      const result = PatternFilter.computeDynamicFillState(poly, filterData);
      expect(result).toBe('unchanged');
    });

    it('returns unchanged for grid mode (TODO)', () => {
      const poly = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [
            { type: 'point', point: new SheetPosition(0, 0) },
            { type: 'point', point: new SheetPosition(10, 10) },
          ],
          { closed: false },
        ),
      );

      const filterData: PatternFilterData = {
        type: 'pattern',
        mode: 'grid',
        geometryId: poly.id,
        xRepeats: 2,
        yRepeats: 2,
      };

      const result = PatternFilter.computeDynamicFillState(poly, filterData);
      expect(result).toBe('unchanged');
    });
  });
});
