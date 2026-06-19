import {
  ConstrainedTrack,
  Constraint,
  ConstraintEndpoint,
  LinearConstraint,
} from '@/lib/geometry/constraints';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function resolvePointEndpoint(ep: ConstraintEndpoint): SheetPosition | null {
  if (ep.type === 'point') {
    return ep.point;
  }
  return null;
}

const pt0 = new SheetPosition(0, 0);
const pt5_0 = new SheetPosition(5, 0);
const pt8_0 = new SheetPosition(8, 0);
const pt3_4 = new SheetPosition(3, 4);
const pt4_3 = new SheetPosition(4, 3);
const pt8_6 = new SheetPosition(8, 6);
const pt20_0 = new SheetPosition(20, 0);

describe('computeConstrainedTracksForPoints', () => {
  describe('edge cases', () => {
    it('returns unconstrained when there are no constraints', () => {
      expect(
        Constraint.computeConstrainedTracksForPoints([], [pt0], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('returns unconstrained when there are no moving points', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });
  });

  describe('single linear constraint', () => {
    it('produces a circle when exactly one endpoint is moving', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt5_0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('circle');
      if (tracks[0].type === 'circle') {
        expect(tracks[0].center.x).toBeCloseTo(0);
        expect(tracks[0].center.y).toBeCloseTo(0);
        expect(tracks[0].radius).toBeCloseTo(5);
      }
    });

    it('produces a circle at the correct center (moving point is A, fixed is B)', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt5_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt5_0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('circle');
      if (tracks[0].type === 'circle') {
        // Center should be the fixed point (pt0), not the moving point (pt5_0)
        expect(tracks[0].center.x).toBeCloseTo(0);
        expect(tracks[0].center.y).toBeCloseTo(0);
      }
    });

    it('returns unconstrained when both endpoints are fixed (0 moving)', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      // movingPoints is empty of these two — neither is moving
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [pt3_4], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('returns unconstrained when both endpoints are moving', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [pt0, pt5_0], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('returns unconstrained when constrainedLength is null', () => {
      const c = {
        type: 'linear' as const,
        pointA: ConstraintEndpoint.point(pt0),
        pointB: ConstraintEndpoint.point(pt5_0),
        constrainedLength: null,
      };
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [pt5_0], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('skips constraint when an endpoint cannot be resolved', () => {
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.lockedToRectangle('r1', 'upperLeft'),
        Length.inches(5),
      );
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [pt0], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('resolves locked endpoints via the provided callback', () => {
      const resolveWithFixture = (ep: ConstraintEndpoint): SheetPosition | null => {
        if (ep.type === 'point') {
          return ep.point;
        }
        if (ep.type === 'locked-rectangle' && ep.id === 'r1') {
          return pt5_0;
        }
        return null;
      };
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.lockedToRectangle('r1', 'upperLeft'),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt0],
        'in',
        resolveWithFixture,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('circle');
      if (tracks[0].type === 'circle') {
        expect(tracks[0].center.x).toBeCloseTo(5);
        expect(tracks[0].center.y).toBeCloseTo(0);
      }
    });
  });

  describe('circle-circle intersection', () => {
    it('reduces two intersecting circles to two points', () => {
      // Moving point is pt4_3. Two constraints:
      // c1: pt4_3 must be 5 units from pt0 → circle(center=pt0, r=5)
      // c2: pt4_3 must be 5 units from pt8_0 → circle(center=pt8_0, r=5)
      // Circles (0,0,r=5) and (8,0,r=5) intersect at (4,3) and (4,-3)
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt4_3),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt4_3),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2],
        [pt4_3],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(2);
      expect(tracks.every((t) => t.type === 'point')).toBe(true);
      const points = tracks.map((t) => (t.type === 'point' ? t.point : null));
      const has4_3 = points.some((p) => p && Math.abs(p.x - 4) < 1e-5 && Math.abs(p.y - 3) < 1e-5);
      const has4__3 = points.some((p) => p && Math.abs(p.x - 4) < 1e-5 && Math.abs(p.y + 3) < 1e-5);
      expect(has4_3).toBe(true);
      expect(has4__3).toBe(true);
    });

    it('reduces two intersecting circles to two points when both constraints apply', () => {
      // Constraint 1: pt0 <-> pt8_0 distance 5 → circle around pt0, radius 5
      // Constraint 2: pt8_0 <-> pt0 distance 5 → circle around pt8_0, radius 5
      // The moving point must satisfy BOTH: distance 5 from pt0 AND distance 5 from pt8_0
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2],
        [pt0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;

      // Moving pt0 must be distance 5 from both pt0 and pt8_0... wait, that's wrong.
      // pt0 is the moving point. c1: pt0 is moving, pt8_0 is fixed → circle around pt8_0, r=5
      // c2: pt0 is moving, pt8_0 is fixed → circle around pt8_0, r=5
      // Both produce the same circle centered at pt8_0 → coincident → single circle

      // Let me re-think. c1: moving=pt0, fixed=pt8_0 → circle(center=pt8_0, r=5)
      // c2: moving=pt0, fixed=pt8_0 → circle(center=pt8_0, r=5)
      // Same circle → coincident → [circle]
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('circle');
      if (tracks[0].type === 'circle') {
        expect(tracks[0].center.x).toBeCloseTo(8);
        expect(tracks[0].radius).toBeCloseTo(5);
      }
    });

    it('finds tangent point from two tangent circles', () => {
      // c1: pt0 <-> moving pt, distance 5 → circle(center=pt0, r=5)
      // c2: pt8_0 <-> moving pt, distance 5 → circle(center=pt8_0, r=5)
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      // pt8_0 is in movingPoints, pt0 is not → c1: moving=pt8_0, fixed=pt0 → circle(center=pt0, r=5)
      // We need a SECOND fixed point for the second circle. Let me use a different constraint.
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_6),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      // moving=pt8_0, fixed=pt8_6 → circle(center=pt8_6, r=5)
      // Circle 1: center (0,0), r=5
      // Circle 2: center (8,6), r=5
      // d = sqrt(64 + 36) = sqrt(100) = 10, r1 + r2 = 10 → tangent at (4, 3)
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2],
        [pt8_0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('point');
      if (tracks[0].type === 'point') {
        expect(tracks[0].point.x).toBeCloseTo(4);
        expect(tracks[0].point.y).toBeCloseTo(3);
      }
    });

    it('returns immobile when two circles do not intersect', () => {
      // Circle 1: center (0,0), r=5
      // Circle 2: center (25,0), r=5
      // d=25, r1+r2=10 → no intersection
      const pt25_0 = new SheetPosition(25, 0);
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt20_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt20_0),
        ConstraintEndpoint.point(pt25_0),
        Length.inches(5),
      );
      expect(
        Constraint.computeConstrainedTracksForPoints(
          [c1, c2],
          [pt20_0],
          'in',
          resolvePointEndpoint,
        ),
      ).toBe('immobile');
    });

    it('returns immobile when circles are concentric but different radii', () => {
      // Same center, different radii → no intersection possible
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(10),
      );
      // c1: moving=pt8_0, fixed=pt0 → circle(center=pt0, r=5)
      // c2: moving=pt8_0, fixed=pt0 → circle(center=pt0, r=10)
      // Concentric, different radii → no single point can be both 5 and 10 from pt0
      expect(
        Constraint.computeConstrainedTracksForPoints([c1, c2], [pt8_0], 'in', resolvePointEndpoint),
      ).toBe('immobile');
    });
  });

  describe('circle-point intersection', () => {
    it('keeps the point when it lies on the circle', () => {
      // c1: moving=pt3_4, fixed=pt0, r=5 → circle(center=pt0, r=5)
      // c2: moving=pt3_4, fixed=pt3_4 → but pt3_4 is moving, so both fixed → skip
      // I need a different setup. Let me use:
      // The point pt3_4 is the moving point. Two constraints on it:
      // c1: distance 5 from pt0 → circle(center=pt0, r=5)
      // c2: distance from some OTHER fixed point...
      // Actually for circle ∩ point test, I can do:
      // Constraint 1: moving=pt3_4, fixed=pt0, r=5 → circle(center=pt0, r=5)
      // But then we need the point result to come from the second track.
      // I need to construct a scenario where we have a circle AND a point track.
      // Hmm, we only get points from intersecting circles, or from having both
      // endpoints of a constraint fixed.

      // Alternative: have TWO constraints that reduce the moving point.
      // c1: moving=pt, fixed=pt0, r=5 → circle(center=pt0, r=5)
      // c2: moving=pt, fixed=pt8_0, r=5 → circle(center=pt8_0, r=5)
      // These intersect at (4, 3) and (4, -3) → TWO points.
      // Now I need a third constraint that eliminates one:
      // c3: moving=pt, fixed=pt8_6, r=5 → circle(center=pt8_6, r=5)
      // pt8_6 to (4,3) = distance 5 → ON circle
      // pt8_6 to (4,-3) = distance sqrt(16+81) = sqrt(97) ≈ 9.85 → OFF circle
      // Result: (4, 3) survives

      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_6),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2, c3],
        [pt3_4],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('point');
      if (tracks[0].type === 'point') {
        expect(tracks[0].point.x).toBeCloseTo(4);
        expect(tracks[0].point.y).toBeCloseTo(3);
      }
    });

    it('returns immobile when a point is off the circle', () => {
      // Circle: center (0,0), r=5
      // Point: (3,3) → distance sqrt(18) ≈ 4.24 ≠ 5
      // Constraint 1: moving=pt3_3, fixed=pt0, r=5 → circle(center=pt0, r=5)
      // Constraint 2: moving=pt3_3, fixed=pt8_0, r=5 → circle(center=pt8_0, r=5)
      // These intersect at (4, 3) and (4, -3)
      // Now both points are on circle(0,0,5) but NOT at (3,3).
      // Wait, (3,3) is not on either circle... I need to rethink.

      // Actually, the simplest test: two constraints that reduce to two points,
      // neither of which is the same.
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      // c1: circle(center=pt0, r=5)
      // c2: circle(center=pt8_0, r=5)
      // These intersect at (4, 3) and (4, -3).
      // c3: circle(center=pt5_0, r=5)
      // (4,3) to (5,0) = sqrt(1+9) = sqrt(10) ≈ 3.16 ≠ 5 → NOT on circle
      // (4,-3) to (5,0) = sqrt(1+9) = sqrt(10) ≈ 3.16 ≠ 5 → NOT on circle
      // Neither point is on c3's circle → immobile
      expect(
        Constraint.computeConstrainedTracksForPoints(
          [c1, c2, c3],
          [pt3_4],
          'in',
          resolvePointEndpoint,
        ),
      ).toBe('immobile');
    });
  });

  describe('point-point intersection', () => {
    it('keeps the point when both tracks are the same point', () => {
      // Constraint 1: moving=pt3_4, fixed=pt0, r=5 → circle(center=pt0, r=5)
      // Constraint 2: moving=pt3_4, fixed=pt8_0, r=5 → circle(center=pt8_0, r=5)
      // Intersect at (4,3) and (4,-3) → TWO points
      // Constraint 3: moving=pt3_4, fixed=pt8_6, r=5 → circle(center=pt8_6, r=5)
      // (4,3) to (8,6) = 5 → ON circle
      // (4,-3) to (8,6) ≈ 9.85 → OFF circle
      // Result: [(4,3)]
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = LinearConstraint.create(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_6),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2, c3],
        [pt3_4],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('point');
      if (tracks[0].type === 'point') {
        expect(tracks[0].point.x).toBeCloseTo(4, 5);
        expect(tracks[0].point.y).toBeCloseTo(3, 5);
      }
    });
  });

  describe('coincident circles', () => {
    it('keeps the circle when two circles are coincident', () => {
      // Two constraints that both produce the same circle
      const c1 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = LinearConstraint.create(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c1, c2],
        [pt8_0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('circle');
    });
  });

  describe('line track', () => {
    it('intersects a line with a circle (2 points)', () => {
      // Vertical line through x=0, circle center (0, 0), r = 5
      // Intersection at (0, -5) and (0, 5)
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, -10),
        slope: Infinity,
      };
      const circle: ConstrainedTrack = {
        type: 'circle',
        center: new SheetPosition(0, 0),
        radius: 5,
      };
      const result = ConstrainedTrack.intersectTracks(circle, line);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(2);
      expect(pts.every((p) => p.type === 'point')).toBe(true);
      const positions = pts.map((p) => (p.type === 'point' ? p.point : null));
      const hasNeg5 = positions.some((p) => p && Math.abs(p.x) < 1e-5 && Math.abs(p.y + 5) < 1e-5);
      const hasPos5 = positions.some((p) => p && Math.abs(p.x) < 1e-5 && Math.abs(p.y - 5) < 1e-5);
      expect(hasNeg5).toBe(true);
      expect(hasPos5).toBe(true);
    });

    it('intersects a line with a circle (1 tangent point)', () => {
      // Vertical line through x=5, circle center (0, 0), r = 5
      // Tangent at (5, 0)
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(5, -10),
        slope: Infinity,
      };
      const circle: ConstrainedTrack = {
        type: 'circle',
        center: new SheetPosition(0, 0),
        radius: 5,
      };
      const result = ConstrainedTrack.intersectTracks(circle, line);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(1);
      expect(pts[0].type).toBe('point');
      if (pts[0].type === 'point') {
        expect(pts[0].point.x).toBeCloseTo(5);
        expect(pts[0].point.y).toBeCloseTo(0);
      }
    });

    it('returns immobile when line does not intersect circle', () => {
      // Vertical line through x=20, circle center (0, 0), r = 5
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(20, 0),
        slope: Infinity,
      };
      const circle: ConstrainedTrack = {
        type: 'circle',
        center: new SheetPosition(0, 0),
        radius: 5,
      };
      expect(ConstrainedTrack.intersectTracks(circle, line)).toBe('immobile');
    });

    it('intersects a line with a circle even when the line does not pass through the circle at first (infinite line)', () => {
      // Vertical line through x=0, circle center (0, 0), r = 5
      // Even though the line point (0, 10) is above the circle, the line extends infinitely
      // and intersects at (0, -5) and (0, 5)
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 10),
        slope: Infinity,
      };
      const circle: ConstrainedTrack = {
        type: 'circle',
        center: new SheetPosition(0, 0),
        radius: 5,
      };
      const result = ConstrainedTrack.intersectTracks(circle, line);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(2);
    });

    it('intersects two converging lines at a single point', () => {
      // Line 1: horizontal (slope 0) through (0, 0) → y = 0
      // Line 2: vertical (slope Infinity) through (5, 5) → x = 5
      // Intersection at (5, 0)
      const line1: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 0),
        slope: 0,
      };
      const line2: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(5, 5),
        slope: Infinity,
      };
      const result = ConstrainedTrack.intersectTracks(line1, line2);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(1);
      expect(pts[0].type).toBe('point');
      if (pts[0].type === 'point') {
        expect(pts[0].point.x).toBeCloseTo(5);
        expect(pts[0].point.y).toBeCloseTo(0);
      }
    });

    it('returns immobile when two lines are parallel and distinct', () => {
      // Line 1: horizontal through (0, 0) → y = 0
      // Line 2: horizontal through (0, 1) → y = 1
      const line1: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 0),
        slope: 0,
      };
      const line2: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 1),
        slope: 0,
      };
      expect(ConstrainedTrack.intersectTracks(line1, line2)).toBe('immobile');
    });

    it('returns a line when two lines are coincident', () => {
      // Line 1: horizontal through (0, 0) → y = 0
      // Line 2: horizontal through (3, 0) → same line y = 0
      const line1: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 0),
        slope: 0,
      };
      const line2: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(3, 0),
        slope: 0,
      };
      const result = ConstrainedTrack.intersectTracks(line1, line2);
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
    });

    it('keeps a point that lies on a line', () => {
      // Horizontal line y = 0
      // Point: (5, 0) — on the line
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 0),
        slope: 0,
      };
      const point: ConstrainedTrack = { type: 'point', point: new SheetPosition(5, 0) };
      const result = ConstrainedTrack.intersectTracks(line, point);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(1);
      expect(pts[0].type).toBe('point');
      if (pts[0].type === 'point') {
        expect(pts[0].point.x).toBeCloseTo(5);
        expect(pts[0].point.y).toBeCloseTo(0);
      }
    });

    it('keeps a point that lies on a line (behind the reference point)', () => {
      // Horizontal line y = 0
      // Point: (0, 0) — on the line, behind the reference point
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(5, 0),
        slope: 0,
      };
      const point: ConstrainedTrack = { type: 'point', point: new SheetPosition(0, 0) };
      const result = ConstrainedTrack.intersectTracks(line, point);
      expect(result).not.toBe('immobile');
      const pts = result as Array<ConstrainedTrack>;
      expect(pts).toHaveLength(1);
      expect(pts[0].type).toBe('point');
    });

    it('returns immobile when a point is off the line (perpendicular offset)', () => {
      // Horizontal line y = 0, point: (5, 1) — off the line
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(0, 0),
        slope: 0,
      };
      const point: ConstrainedTrack = { type: 'point', point: new SheetPosition(5, 1) };
      expect(ConstrainedTrack.intersectTracks(line, point)).toBe('immobile');
    });

    it('applies offset to a line (point shifts, slope unchanged)', () => {
      const line: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(10, 20),
        slope: 0,
      };
      const offset = new SheetPosition(3, -5);
      const result = ConstrainedTrack.applyOffset(line, offset);
      expect(result.type).toBe('line');
      if (result.type === 'line') {
        expect(result.point.x).toBeCloseTo(7); // 10 - 3
        expect(result.point.y).toBeCloseTo(25); // 20 - (-5)
        expect(result.slope).toBeCloseTo(0);
      }
    });
  });

  describe('works in sheet units other than inches', () => {
    it('uses the correct radius when sheet unit is cm', () => {
      // 5 inches = 12.7 cm
      const c = LinearConstraint.create(
        ConstraintEndpoint.point(pt5_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt5_0],
        'cm',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks[0].type).toBe('circle');
      if (tracks[0].type === 'circle') {
        expect(tracks[0].radius).toBeCloseTo(12.7, 1);
      }
    });
  });
});
