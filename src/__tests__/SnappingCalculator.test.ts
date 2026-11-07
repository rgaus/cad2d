import { type FilterComponent } from '@/lib/entity/components/FilterComponent';
import { MirrorFilter } from '@/lib/entity/filters/mirror';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import {
  type SnappingLineSeriesOptions,
  type SnappingOptions,
  applySnapping,
  applySnappingLineSeries,
} from '@/lib/snapping';
import { SheetPosition } from '../lib/viewport/types';

function pt(x: number, y: number): SheetPosition {
  return new SheetPosition(x, y);
}

describe('applySnapping', () => {
  describe('ctrl disables all snapping', () => {
    it('returns original position when ctrl is held', () => {
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: true,
        superHeld: false,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(3.7);
      expect(result.y).toBeCloseTo(5.3);
    });
  });

  describe('grid snapping', () => {
    it('snaps to grid lines', () => {
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: false,
        superHeld: false,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(3.8, 1);
      expect(result.y).toBeCloseTo(5.2, 1);
    });

    it('handles null secondary grid size', () => {
      const pos = new SheetPosition(3.7, 5.3);
      const result = applySnapping(pos, {
        primaryGridSize: 1,
        secondaryGridSize: null,
        ctrlHeld: false,
        superHeld: false,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(4, 1);
      expect(result.y).toBeCloseTo(5, 1);
    });
  });
});

function mirrorFilter(
  id: string,
  pointA: SheetPosition,
  pointB: SheetPosition,
): FilterComponentOnly {
  return { id, ...MirrorFilter.create('geometry', pointA, pointB) };
}

type FilterComponentOnly = {
  id: string;
  components: FilterComponent;
};

function gridPatternFilter(
  id: string,
  upperLeft: SheetPosition,
  lowerRight: SheetPosition,
): FilterComponentOnly {
  return { id, ...PatternFilter.createGrid('geometry', upperLeft, lowerRight) };
}

const filterOptions: SnappingOptions = {
  primaryGridSize: 1,
  secondaryGridSize: null,
  ctrlHeld: false,
  superHeld: false,
  viewportScale: 1,
};

describe('applySnapping with filter snapping', () => {
  it('ctrl bypasses filter snapping', () => {
    const mirror = mirrorFilter('flt_mirror', pt(0, 10), pt(20, 10));

    const result = applySnapping(pt(5, 9.8), {
      ...filterOptions,
      ctrlHeld: true,
      selectedGeometryFilters: [mirror],
    });

    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(9.8);
  });

  it('snaps to a horizontal mirror line with grid detents', () => {
    const mirror = mirrorFilter('flt_mirror', pt(0, 10.3), pt(20, 10.3));

    const result = applySnapping(pt(3.3, 10.4), {
      ...filterOptions,
      selectedGeometryFilters: [mirror],
    });

    expect(result.x).toBeCloseTo(3);
    expect(result.y).toBeCloseTo(10.3);
  });

  it('snaps to a vertical mirror line with grid detents', () => {
    const mirror = mirrorFilter('flt_mirror', pt(10.3, 0), pt(10.3, 20));

    const result = applySnapping(pt(10.4, 3.3), {
      ...filterOptions,
      selectedGeometryFilters: [mirror],
    });

    expect(result.x).toBeCloseTo(10.3);
    expect(result.y).toBeCloseTo(3);
  });

  it('snaps to the nearest filter candidate rather than the first', () => {
    const farMirror = mirrorFilter('flt_far', pt(0.2, 0), pt(0.2, 10));
    const nearMirror = mirrorFilter('flt_near', pt(0.05, 0), pt(0.05, 10));

    const result = applySnapping(pt(0, 0), {
      ...filterOptions,
      selectedGeometryFilters: [farMirror, nearMirror],
    });

    expect(result.x).toBeCloseTo(0.05);
    expect(result.y).toBeCloseTo(0);
  });

  it('includes the closing edge of a pattern grid frame', () => {
    const pattern = gridPatternFilter('flt_pattern', pt(0.3, 0), pt(10.3, 10));

    const result = applySnapping(pt(0.4, 5.2), {
      ...filterOptions,
      selectedGeometryFilters: [pattern],
    });

    expect(result.x).toBeCloseTo(0.3);
    expect(result.y).toBeCloseTo(5);
  });
});

describe('applySnappingLineSeries', () => {
  describe('angular snapping with super', () => {
    it('snaps to 0 degrees (horizontal right)', () => {
      const pos = new SheetPosition(5, 5);
      const prev = new SheetPosition(0, 5);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: false,
        superHeld: true,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(5, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 90 degrees (vertical up)', () => {
      const pos = new SheetPosition(0, 5);
      const prev = new SheetPosition(0, 10);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: false,
        superHeld: true,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(0, 0);
      expect(result.y).toBeCloseTo(5, 0);
    });

    it('snaps to 45 degrees', () => {
      const pos = new SheetPosition(5, 5);
      const prev = new SheetPosition(0, 0);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: false,
        superHeld: true,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });

    it('angular snapping applies after grid snapping', () => {
      const pos = new SheetPosition(0.5, 0.5);
      const prev = new SheetPosition(0, 0);
      const result = applySnappingLineSeries(pos, prev, {
        primaryGridSize: 1,
        secondaryGridSize: 0.2,
        ctrlHeld: false,
        superHeld: true,
        viewportScale: 1,
      });
      expect(result.x).toBeCloseTo(result.y, 1);
    });
  });

  describe('exactDistance', () => {
    const defaultOptions: SnappingLineSeriesOptions = {
      primaryGridSize: 1,
      secondaryGridSize: 0.1,
      ctrlHeld: false,
      superHeld: false,
      viewportScale: 1,
    };

    it('constrains the result to be exactly at the given distance from prevPoint', () => {
      const prev = new SheetPosition(0, 0);
      const pos = new SheetPosition(10, 10);
      const result = applySnappingLineSeries(pos, prev, { ...defaultOptions, exactDistance: 5 });
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(5, 5);
      expect(result.x).toBeCloseTo(result.y, 2);
    });

    it('works with a horizontal offset', () => {
      const prev = new SheetPosition(1, 1);
      const pos = new SheetPosition(10, 1);
      const result = applySnappingLineSeries(pos, prev, { ...defaultOptions, exactDistance: 3 });
      expect(result.x).toBeCloseTo(4, 5);
      expect(result.y).toBeCloseTo(1, 5);
    });

    it('works with a vertical offset', () => {
      const prev = new SheetPosition(1, 1);
      const pos = new SheetPosition(1, 10);
      const result = applySnappingLineSeries(pos, prev, { ...defaultOptions, exactDistance: 3 });
      expect(result.x).toBeCloseTo(1, 5);
      expect(result.y).toBeCloseTo(4, 5);
    });
  });
});
