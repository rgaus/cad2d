import { type ConstrainedTrack } from '@/lib/geometry';
import { type SnappingOptions, applySnappingOnConstrainedTrack } from '@/lib/snapping';
import { SheetPosition } from '@/lib/viewport/types';

const defaultOptions: SnappingOptions = {
  primaryGridSize: 1,
  secondaryGridSize: null,
  shiftHeld: false,
  superHeld: false,
};

const shiftOptions: SnappingOptions = { ...defaultOptions, shiftHeld: true };

function pt(x: number, y: number): SheetPosition {
  return new SheetPosition(x, y);
}

function circle(center: SheetPosition, radius: number): ConstrainedTrack {
  return { type: 'circle', center, radius };
}

function point(point: SheetPosition): ConstrainedTrack {
  return { type: 'point', point };
}

function line(point: SheetPosition, slope: number): ConstrainedTrack {
  return { type: 'line', point, slope };
}

describe('applySnappingOnConstrainedTrack', () => {
  describe('no constrained tracks', () => {
    it('behaves like applySnapping when track list is empty (grid snap applies)', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], defaultOptions);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('behaves like applySnapping when track list is empty (shift bypasses grid)', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], shiftOptions);
      expect(result.x).toBeCloseTo(0.3);
      expect(result.y).toBeCloseTo(0.7);
    });
  });

  describe('single circle track', () => {
    it('snaps to the nearest point on the circle perimeter', () => {
      // Circle at (0,0) radius 5. Input (8,0).
      // Projection: (5, 0). snapDist = |8-5| = 3.
      const result = applySnappingOnConstrainedTrack(pt(8, 0), [circle(pt(0, 0), 5)], shiftOptions);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps a point inside the circle outward to the perimeter', () => {
      // Circle at (0,0) radius 5. Input (-2, 0) is inside.
      // Projection: (-5, 0). snapDist = |2-5| = 3.
      const result = applySnappingOnConstrainedTrack(
        pt(-2, 0),
        [circle(pt(0, 0), 5)],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(-5);
      expect(result.y).toBeCloseTo(0);
    });

    it('stays put when the point is already on the perimeter', () => {
      // Point (3,4) is on circle(0,0,5).
      const result = applySnappingOnConstrainedTrack(pt(3, 4), [circle(pt(0, 0), 5)], shiftOptions);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });

    it('skips the circle when point is exactly at the center (no unique projection)', () => {
      // Center → can't project, falls back to grid-snapped pos
      const result = applySnappingOnConstrainedTrack(pt(0, 0), [circle(pt(0, 0), 5)], shiftOptions);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('single point track', () => {
    it('snaps to the point', () => {
      const result = applySnappingOnConstrainedTrack(pt(8, 0), [point(pt(3, 4))], shiftOptions);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });
  });

  describe('multiple tracks - picks closest', () => {
    it('picks the closer of two circles', () => {
      // Circle 1: (0,0) r=5, input (8,0) → snapDist=3, target (5,0)
      // Circle 2: (10,0) r=3, input (8,0) → snapDist=1, target (7,0)
      // Circle 2 is closer → snaps to (7,0)
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [circle(pt(0, 0), 5), circle(pt(10, 0), 3)],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(7);
      expect(result.y).toBeCloseTo(0);
    });

    it('picks the closer of two points', () => {
      // Point A (3,4), Point B (-5,0), input (8,0)
      // dist to A ≈ 6.4, dist to B = 13 → A is closer
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [point(pt(-5, 0)), point(pt(3, 4))],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });

    it('picks a point over a circle when the point is closer', () => {
      // Circle: (0,0) r=5, input (8,0) → snapDist=3, target (5,0)
      // Point: (6,0), input (8,0) → snapDist=2
      // Point is closer
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [circle(pt(0, 0), 5), point(pt(6, 0))],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(6);
      expect(result.y).toBeCloseTo(0);
    });

    it('picks a circle over a point when the circle is closer', () => {
      // Circle: (0,0) r=5, input (8,0) → snapDist=3, target (5,0)
      // Point: (20,0), input (8,0) → snapDist=12
      // Circle is closer
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [circle(pt(0, 0), 5), point(pt(20, 0))],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });

    it('point at circle center skips the circle and falls back to a point track', () => {
      // Circle: (0,0) r=5, input (0,0) → skipped (center)
      // Point: (6,0), input (0,0) → snapDist=6
      // Point wins by default since circle was skipped
      const result = applySnappingOnConstrainedTrack(
        pt(0, 0),
        [circle(pt(0, 0), 5), point(pt(6, 0))],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(6);
      expect(result.y).toBeCloseTo(0);
    });

    it('when all circles are at centers, falls back to grid-snapped position', () => {
      // Two circles, both at center positions that can't be projected
      const result = applySnappingOnConstrainedTrack(
        pt(0, 0),
        [circle(pt(0, 0), 5), circle(pt(0, 0), 10)],
        shiftOptions,
      );
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('grid snap applies before track snap', () => {
    it('grid-snaps then snaps to the nearest track', () => {
      // primaryGridSize=1, no shift
      // Input (3.3, 4.7) → grid-snapped to (3, 5)
      // Then snap to circle(0,0,5): dx=3, dy=5, dist≈5.83, snapDist≈0.83
      // Target: (0 + 3/5.83*5, 0 + 5/5.83*5) ≈ (2.57, 4.29)
      const result = applySnappingOnConstrainedTrack(
        pt(3.3, 4.7),
        [circle(pt(0, 0), 5)],
        defaultOptions,
      );
      // Verify it's on the circle perimeter
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(5, 5);
      // Verify it's not the raw grid snap point (grid snap alone would give (3,5))
      expect(result.x).not.toBeCloseTo(3);
    });

    it('shift held bypasses grid snap before track snap', () => {
      // shift=held, input (3.3, 4.7) stays as-is
      // Then snap to circle(0,0,5): dx=3.3, dy=4.7, dist≈5.74, snapDist≈0.74
      // Target: (0 + 3.3/5.74*5, 0 + 4.7/5.74*5) ≈ (2.87, 4.09)
      const result = applySnappingOnConstrainedTrack(
        pt(3.3, 4.7),
        [circle(pt(0, 0), 5)],
        shiftOptions,
      );
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(5, 5);
    });
  });

  describe('union type inputs', () => {
    it('returns pos unchanged when passed immobile', () => {
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.7), 'immobile', defaultOptions);
      expect(result.x).toBeCloseTo(3.3);
      expect(result.y).toBeCloseTo(4.7);
    });

    it('behaves like applySnapping when passed unconstrained', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), 'unconstrained', defaultOptions);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('behaves like applySnapping when passed empty array', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], defaultOptions);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });
  });

  describe('or tracks', () => {
    it('snaps to the closer line within an or', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: pt(5, 0), slope: Infinity },
          { type: 'line', point: pt(-5, 0), slope: Infinity },
        ],
      };
      // Mouse at (6, 3) — closer to x=5 than x=-5
      const result = applySnappingOnConstrainedTrack(pt(6, 3), [orTrack], shiftOptions);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(3);
    });

    it('snaps to the closer track within an or (line vs circle)', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [{ type: 'line', point: pt(10, 0), slope: Infinity }, circle(pt(0, 0), 5)],
      };
      // Mouse at (4, 0) — distance to x=10 line is 6, distance to circle radius 5 is 1
      // Circle is closer
      const result = applySnappingOnConstrainedTrack(pt(4, 0), [orTrack], shiftOptions);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('circle track with 15-degree angle snap', () => {
    it('snaps the circle target to nearest 15-degree radial when shift is not held', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 3) — angle ~16.7deg, nearest 15deg is 15deg (0.262 rad)
      const result = applySnappingOnConstrainedTrack(pt(10, 3), [c], defaultOptions);
      const expectedX = 10 * Math.cos((15 * Math.PI) / 180);
      const expectedY = 10 * Math.sin((15 * Math.PI) / 180);
      expect(result.x).toBeCloseTo(expectedX);
      expect(result.y).toBeCloseTo(expectedY);
    });

    it('snaps to 0 degrees when the angle is closer to 0 than 15', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 0.5) — angle ~2.86deg, nearest 15deg is 0deg
      const result = applySnappingOnConstrainedTrack(pt(10, 0.5), [c], defaultOptions);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(0);
    });

    it('does not apply angle snap when shift is held', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 3) — angle ~16.7deg, shift held: no snap
      const result = applySnappingOnConstrainedTrack(pt(10, 3), [c], shiftOptions);
      const angle = Math.atan2(3, 10);
      const expectedX = 10 * Math.cos(angle);
      const expectedY = 10 * Math.sin(angle);
      expect(result.x).toBeCloseTo(expectedX);
      expect(result.y).toBeCloseTo(expectedY);
    });
  });

  describe('line track with perpendicular grid snap', () => {
    it('horizontal line snaps projected x to grid when shift is not held', () => {
      const l = line(pt(0, 5), 0);
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], defaultOptions);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(5);
    });

    it('horizontal line respects secondary grid for x snap', () => {
      const l = line(pt(0, 5), 0);
      const options: SnappingOptions = {
        ...defaultOptions,
        secondaryGridSize: 0.5,
      };
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], options);
      expect(result.x).toBeCloseTo(3.5);
      expect(result.y).toBeCloseTo(5);
    });

    it('horizontal line does not grid-snap x when shift is held', () => {
      const l = line(pt(0, 5), 0);
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], shiftOptions);
      expect(result.x).toBeCloseTo(3.3);
      expect(result.y).toBeCloseTo(5);
    });

    it('vertical line snaps projected y to grid when shift is not held', () => {
      const l = line(pt(5, 0), Infinity);
      const result = applySnappingOnConstrainedTrack(pt(4.9, 3.3), [l], defaultOptions);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(3);
    });

    it('vertical line does not grid-snap y when shift is held', () => {
      const l = line(pt(5, 0), Infinity);
      const result = applySnappingOnConstrainedTrack(pt(4.9, 3.3), [l], shiftOptions);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(3.3);
    });

    it('sloped line does not apply perpendicular grid snap', () => {
      const l = line(pt(0, 0), 1);
      const result = applySnappingOnConstrainedTrack(pt(4, 0), [l], defaultOptions);
      expect(result.x).toBeCloseTo(2);
      expect(result.y).toBeCloseTo(2);
    });

    it('point track does not apply extra snap regardless of shift', () => {
      const p = point(pt(5, 5));
      const resultNoShift = applySnappingOnConstrainedTrack(pt(5, 5), [p], defaultOptions);
      const resultShift = applySnappingOnConstrainedTrack(pt(5, 5), [p], shiftOptions);
      expect(resultNoShift.x).toBeCloseTo(5);
      expect(resultNoShift.y).toBeCloseTo(5);
      expect(resultShift.x).toBeCloseTo(5);
      expect(resultShift.y).toBeCloseTo(5);
    });
  });
});
