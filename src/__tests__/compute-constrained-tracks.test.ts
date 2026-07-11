import {
  ColinearConstraint,
  ColinearConstraintComponent,
  ConstrainedTrack,
  Constraint,
  ConstraintEndpoint,
  Geometry,
  HorizontalConstraint,
  HorizontalConstraintComponent,
  LinearConstraint,
  LinearConstraintComponent,
  VerticalConstraint,
  VerticalConstraintComponent,
} from '@/lib/geometry';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function resolvePointEndpoint(ep: ConstraintEndpoint): SheetPosition | null {
  if (ep.type === 'point') {
    return ep.point;
  }
  return null;
}

function testConstraint(
  pointA: ConstraintEndpoint,
  pointB: ConstraintEndpoint,
  length: Length,
  options?: { connectorLineOffsetPx?: number; axis?: 'x' | 'y' | null },
): Geometry<LinearConstraintComponent> {
  return {
    id: 'test',
    ...LinearConstraint.create(pointA, pointB, length, options),
  };
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
      const c = testConstraint(
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
      const c = testConstraint(
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
      const c = testConstraint(
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
      const c = testConstraint(
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
      const c = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
      );
      expect(
        Constraint.computeConstrainedTracksForPoints([c], [pt0, pt5_0], 'in', resolvePointEndpoint),
      ).toBe('unconstrained');
    });

    it('skips constraint when an endpoint cannot be resolved', () => {
      const c = testConstraint(
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
      const c = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt4_3),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c2 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      // pt8_0 is in movingPoints, pt0 is not → c1: moving=pt8_0, fixed=pt0 → circle(center=pt0, r=5)
      // We need a SECOND fixed point for the second circle. Let me use a different constraint.
      const c2 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt20_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
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

      const c1 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
        ConstraintEndpoint.point(pt3_4),
        ConstraintEndpoint.point(pt8_0),
        Length.inches(5),
      );
      const c3 = testConstraint(
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
      const c1 = testConstraint(
        ConstraintEndpoint.point(pt8_0),
        ConstraintEndpoint.point(pt0),
        Length.inches(5),
      );
      const c2 = testConstraint(
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
      const c = testConstraint(
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

  describe('axis constraints', () => {
    it('x-axis constraint produces vertical line tracks when pointA moves', () => {
      const c = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
        { axis: 'x' },
      );

      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      const orTrack = tracks[0];
      expect(orTrack.type).toBe('or');
      if (orTrack.type === 'or') {
        expect(orTrack.inner).toHaveLength(2);
        for (const t of orTrack.inner) {
          expect(t.type).toBe('line');
          if (t.type === 'line') {
            expect(t.slope).toBe(Infinity);
          }
        }
      }
    });

    it('x-axis constraint produces vertical line tracks when pointB moves', () => {
      const c = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt5_0),
        Length.inches(5),
        { axis: 'x' },
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
      const orTrack = tracks[0];
      expect(orTrack.type).toBe('or');
      if (orTrack.type === 'or') {
        expect(orTrack.inner).toHaveLength(2);
        for (const t of orTrack.inner) {
          expect(t.type).toBe('line');
          if (t.type === 'line') {
            expect(t.slope).toBe(Infinity);
          }
        }
      }
    });

    it('y-axis constraint produces horizontal line tracks when pointA moves', () => {
      const c = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt3_4),
        Length.inches(4),
        { axis: 'y' },
      );

      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt0],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      const orTrack = tracks[0];
      expect(orTrack.type).toBe('or');
      if (orTrack.type === 'or') {
        expect(orTrack.inner).toHaveLength(2);
        for (const t of orTrack.inner) {
          expect(t.type).toBe('line');
          if (t.type === 'line') {
            expect(t.slope).toBe(0);
          }
        }
      }
    });

    it('y-axis constraint produces horizontal line tracks when pointB moves', () => {
      const c = testConstraint(
        ConstraintEndpoint.point(pt0),
        ConstraintEndpoint.point(pt3_4),
        Length.inches(4),
        { axis: 'y' },
      );

      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [pt3_4],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      const orTrack = tracks[0];
      expect(orTrack.type).toBe('or');
      if (orTrack.type === 'or') {
        expect(orTrack.inner).toHaveLength(2);
        for (const t of orTrack.inner) {
          expect(t.type).toBe('line');
          if (t.type === 'line') {
            expect(t.slope).toBe(0);
          }
        }
      }
    });
  });

  describe('or track intersections', () => {
    it('or of two vertical lines AND a horizontal line produces two intersection points', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: pt5_0, slope: Infinity },
          { type: 'line', point: new SheetPosition(-5, 0), slope: Infinity },
        ],
      };
      const hLine: ConstrainedTrack = { type: 'line', point: pt5_0, slope: 0 };

      const result = ConstrainedTrack.intersectTracks(orTrack, hLine);
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('or');
      if (tracks[0].type === 'or') {
        expect(tracks[0].inner).toHaveLength(2);
        for (const t of tracks[0].inner) {
          expect(t.type).toBe('point');
          if (t.type === 'point') {
            expect(t.point.y).toBeCloseTo(0);
          }
        }
      }
    });

    it('or of two vertical lines AND an immobile line is still valid for the intersecting one', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: pt5_0, slope: Infinity },
          { type: 'line', point: new SheetPosition(-5, 0), slope: Infinity },
        ],
      };
      const hLine: ConstrainedTrack = { type: 'line', point: pt5_0, slope: 0 };

      const result = ConstrainedTrack.intersectTracks(orTrack, hLine);
      expect(result).not.toBe('immobile');
      expect((result as Array<ConstrainedTrack>).length).toBe(1);
    });

    it('or AND circle with non-intersecting inner gives a single point', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: new SheetPosition(0, 0), slope: Infinity },
          { type: 'line', point: new SheetPosition(10, 0), slope: Infinity },
        ],
      };
      const circle: ConstrainedTrack = { type: 'circle', center: pt0, radius: 3 };

      const result = ConstrainedTrack.intersectTracks(orTrack, circle);
      expect(result).not.toBe('immobile');
      // Circle at origin radius 3 intersects vertical line at x=0 → points (0, ±3)
      // Vertical line at x=10 doesn't intersect → discarded
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks.length).toBeGreaterThanOrEqual(1);
    });

    it('or AND or distributes over Cartesian product', () => {
      const orA: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: new SheetPosition(5, 0), slope: Infinity },
          { type: 'line', point: new SheetPosition(-5, 0), slope: Infinity },
        ],
      };
      const orB: ConstrainedTrack = {
        type: 'or',
        inner: [
          { type: 'line', point: new SheetPosition(0, 5), slope: 0 },
          { type: 'line', point: new SheetPosition(0, -5), slope: 0 },
        ],
      };

      const result = ConstrainedTrack.intersectTracks(orA, orB);
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('or');
      if (tracks[0].type === 'or') {
        expect(tracks[0].inner).toHaveLength(4);
        for (const t of tracks[0].inner) {
          expect(t.type).toBe('point');
        }
      }
    });

    it('avoids single-element or wrapping', () => {
      const orTrack: ConstrainedTrack = {
        type: 'or',
        inner: [{ type: 'line', point: new SheetPosition(0, 0), slope: 0 }],
      };
      const vLine: ConstrainedTrack = {
        type: 'line',
        point: new SheetPosition(5, 0),
        slope: Infinity,
      };

      const result = ConstrainedTrack.intersectTracks(orTrack, vLine);
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('point');
    });
  });

  describe('ConstrainedTrack.restrictToAxis', () => {
    describe('circle restricted to y-axis (x fixed)', () => {
      it('returns a horizontal line when the circle is tangent to the axis line', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(5, 0), radius: 5 };
        const result = ConstrainedTrack.restrictToAxis(c, 10, 'y');
        expect(result).not.toBe('immobile');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(0);
          expect(track.point.y).toBeCloseTo(0);
        }
      });

      it('returns an or of two horizontal lines when the circle intersects twice', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(5, 0), radius: 5 };
        const result = ConstrainedTrack.restrictToAxis(c, 5, 'y');
        expect(result).not.toBe('immobile');
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('or');
        if (track.type === 'or') {
          expect(track.inner).toHaveLength(2);
          for (const inner of track.inner) {
            expect(inner.type).toBe('line');
            if (inner.type === 'line') {
              expect(inner.slope).toBe(0);
            }
          }
          const yVals = track.inner
            .map((t) => (t.type === 'line' ? t.point.y : NaN))
            .sort((a, b) => a - b);
          expect(yVals[0]).toBeCloseTo(-5);
          expect(yVals[1]).toBeCloseTo(5);
        }
      });

      it('returns immobile when the circle does not intersect the axis line', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(0, 0), radius: 3 };
        const result = ConstrainedTrack.restrictToAxis(c, 10, 'y');
        expect(result).toBe('immobile');
      });
    });

    describe('circle restricted to x-axis (y fixed)', () => {
      it('returns a vertical line when the circle is tangent to the axis line', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(0, 5), radius: 5 };
        const result = ConstrainedTrack.restrictToAxis(c, 10, 'x');
        expect(result).not.toBe('immobile');
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(Infinity);
          expect(track.point.x).toBeCloseTo(0);
        }
      });

      it('returns an or of two vertical lines when the circle intersects twice', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(0, 5), radius: 5 };
        const result = ConstrainedTrack.restrictToAxis(c, 5, 'x');
        expect(result).not.toBe('immobile');
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('or');
        if (track.type === 'or') {
          expect(track.inner).toHaveLength(2);
          for (const inner of track.inner) {
            expect(inner.type).toBe('line');
            if (inner.type === 'line') {
              expect(inner.slope).toBe(Infinity);
            }
          }
          const xVals = track.inner
            .map((t) => (t.type === 'line' ? t.point.x : NaN))
            .sort((a, b) => a - b);
          expect(xVals[0]).toBeCloseTo(-5);
          expect(xVals[1]).toBeCloseTo(5);
        }
      });

      it('returns immobile when the circle does not intersect the axis line', () => {
        const c: ConstrainedTrack = { type: 'circle', center: new SheetPosition(0, 0), radius: 3 };
        const result = ConstrainedTrack.restrictToAxis(c, 10, 'x');
        expect(result).toBe('immobile');
      });
    });

    describe('line restricted to axis', () => {
      it('returns null when a vertical line is coincident with the y-axis line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(5, 0),
          slope: Infinity,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 5, 'y');
        expect(result).toBeNull();
      });

      it('returns immobile when a vertical line does not intersect the y-axis line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(5, 0),
          slope: Infinity,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 10, 'y');
        expect(result).toBe('immobile');
      });

      it('returns a horizontal line when a horizontal line is restricted to y-axis', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(0, 3),
          slope: 0,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 5, 'y');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(0);
          expect(track.point.y).toBeCloseTo(3);
        }
      });

      it('returns null when horizontal line is coincident with x-axis line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(0, 5),
          slope: 0,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 5, 'x');
        expect(result).toBeNull();
      });

      it('returns immobile when horizontal line does not intersect x-axis line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(0, 5),
          slope: 0,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 10, 'x');
        expect(result).toBe('immobile');
      });

      it('restricts a sloped line to y-axis to a horizontal line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(0, 4),
          slope: 2,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 2, 'y');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(0);
          expect(track.point.y).toBeCloseTo(8);
        }
      });

      it('restricts a sloped line to x-axis to a vertical line', () => {
        const l: ConstrainedTrack = {
          type: 'line',
          point: new SheetPosition(0, 4),
          slope: 2,
        };
        const result = ConstrainedTrack.restrictToAxis(l, 8, 'x');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(Infinity);
          expect(track.point.x).toBeCloseTo(2);
        }
      });
    });

    describe('point restricted to axis', () => {
      it('returns horizontal line when point is on the y-axis line', () => {
        const p: ConstrainedTrack = { type: 'point', point: new SheetPosition(3, 7) };
        const result = ConstrainedTrack.restrictToAxis(p, 3, 'y');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(0);
          expect(track.point.y).toBeCloseTo(7);
        }
      });

      it('returns immobile when point is off the y-axis line', () => {
        const p: ConstrainedTrack = { type: 'point', point: new SheetPosition(3, 7) };
        const result = ConstrainedTrack.restrictToAxis(p, 10, 'y');
        expect(result).toBe('immobile');
      });

      it('returns vertical line when point is on the x-axis line', () => {
        const p: ConstrainedTrack = { type: 'point', point: new SheetPosition(3, 7) };
        const result = ConstrainedTrack.restrictToAxis(p, 7, 'x');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(Infinity);
          expect(track.point.x).toBeCloseTo(3);
        }
      });
    });

    describe('or track restricted to axis', () => {
      it('restricts each inner and drops immobile ones', () => {
        const orTrack: ConstrainedTrack = {
          type: 'or',
          inner: [
            { type: 'line', point: new SheetPosition(0, 5), slope: 0 },
            { type: 'point', point: new SheetPosition(10, 10) },
          ],
        };
        const result = ConstrainedTrack.restrictToAxis(orTrack, 0, 'y');
        expect(result).not.toBeNull();
        const track = result as ConstrainedTrack;
        expect(track.type).toBe('line');
        if (track.type === 'line') {
          expect(track.slope).toBe(0);
          expect(track.point.y).toBeCloseTo(5);
        }
      });

      it('returns immobile when all inners produce immobile', () => {
        const orTrack: ConstrainedTrack = {
          type: 'or',
          inner: [
            { type: 'line', point: new SheetPosition(5, 0), slope: Infinity },
            { type: 'point', point: new SheetPosition(10, 3) },
          ],
        };
        const result = ConstrainedTrack.restrictToAxis(orTrack, 3, 'y');
        expect(result).toBe('immobile');
      });
    });
  });

  describe('horizontal constraint', () => {
    const ptA = new SheetPosition(3, 5);
    const ptB = new SheetPosition(8, 5);

    it('produces a horizontal line track when pointB moves and pointA is fixed', () => {
      const c: Geometry<HorizontalConstraintComponent> = {
        id: 'h1',
        ...HorizontalConstraint.create(
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptB],
        'in',
        resolvePointEndpoint,
      );
      expect(result).not.toBe('unconstrained');
      expect(result).not.toBe('immobile');
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(0);
        expect(tracks[0].point.x).toBeCloseTo(ptA.x);
        expect(tracks[0].point.y).toBeCloseTo(ptA.y);
      }
    });

    it('produces a horizontal line track when pointA moves and pointB is fixed', () => {
      const c: Geometry<HorizontalConstraintComponent> = {
        id: 'h2',
        ...HorizontalConstraint.create(
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(0);
        expect(tracks[0].point.x).toBeCloseTo(ptB.x);
        expect(tracks[0].point.y).toBeCloseTo(ptB.y);
      }
    });

    it('skips when both endpoints are moving', () => {
      const c: Geometry<HorizontalConstraintComponent> = {
        id: 'h3',
        ...HorizontalConstraint.create(
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA, ptB],
        'in',
        resolvePointEndpoint,
      );
      expect(result).toBe('unconstrained');
    });

    it('skips when neither endpoint is moving', () => {
      const c: Geometry<HorizontalConstraintComponent> = {
        id: 'h4',
        ...HorizontalConstraint.create(
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [new SheetPosition(99, 99)],
        'in',
        resolvePointEndpoint,
      );
      expect(result).toBe('unconstrained');
    });
  });

  describe('vertical constraint', () => {
    const ptA = new SheetPosition(5, 3);
    const ptB = new SheetPosition(5, 8);

    it('produces a vertical line track when pointB moves and pointA is fixed', () => {
      const c: Geometry<VerticalConstraintComponent> = {
        id: 'v1',
        ...VerticalConstraint.create(ConstraintEndpoint.point(ptA), ConstraintEndpoint.point(ptB)),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptB],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(Infinity);
        expect(tracks[0].point.x).toBeCloseTo(ptA.x);
        expect(tracks[0].point.y).toBeCloseTo(ptA.y);
      }
    });

    it('produces a vertical line track when pointA moves and pointB is fixed', () => {
      const c: Geometry<VerticalConstraintComponent> = {
        id: 'v2',
        ...VerticalConstraint.create(ConstraintEndpoint.point(ptA), ConstraintEndpoint.point(ptB)),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(Infinity);
        expect(tracks[0].point.x).toBeCloseTo(ptB.x);
        expect(tracks[0].point.y).toBeCloseTo(ptB.y);
      }
    });

    it('skips when both endpoints are moving', () => {
      const c: Geometry<VerticalConstraintComponent> = {
        id: 'v3',
        ...VerticalConstraint.create(ConstraintEndpoint.point(ptA), ConstraintEndpoint.point(ptB)),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA, ptB],
        'in',
        resolvePointEndpoint,
      );
      expect(result).toBe('unconstrained');
    });
  });

  describe('colinear constraint', () => {
    const ptTarget = new SheetPosition(0, 5);
    const ptA = new SheetPosition(5, 5);
    const ptB = new SheetPosition(10, 10);

    it('produces line through A and B when only target moves', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c1',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(ptTarget),
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      // A(5,5) B(10,10): slope = (10-5)/(10-5) = 1
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptTarget],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(1);
      }
    });

    it('produces line through target and B when only A moves', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c2',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(ptTarget),
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      // target(0,5) B(10,10): slope = (10-5)/(10-0) = 0.5
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(0.5);
      }
    });

    it('produces line through target and A when only B moves', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c3',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(ptTarget),
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      // target(0,5) A(5,5): slope = (5-5)/(5-0) = 0
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptB],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBeCloseTo(0);
      }
    });

    it('skips when all three endpoints are moving', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c4',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(ptTarget),
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptTarget, ptA, ptB],
        'in',
        resolvePointEndpoint,
      );
      expect(result).toBe('unconstrained');
    });

    it('skips when two endpoints are moving', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c5',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(ptTarget),
          ConstraintEndpoint.point(ptA),
          ConstraintEndpoint.point(ptB),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [ptA, ptB],
        'in',
        resolvePointEndpoint,
      );
      expect(result).toBe('unconstrained');
    });

    it('produces Infinity slope for vertical reference line', () => {
      const c: Geometry<ColinearConstraintComponent> = {
        id: 'c6',
        ...ColinearConstraint.create(
          ConstraintEndpoint.point(new SheetPosition(5, 0)),
          ConstraintEndpoint.point(new SheetPosition(5, 5)),
          ConstraintEndpoint.point(new SheetPosition(5, 10)),
        ),
      };
      const result = Constraint.computeConstrainedTracksForPoints(
        [c],
        [new SheetPosition(5, 0)],
        'in',
        resolvePointEndpoint,
      );
      const tracks = result as Array<ConstrainedTrack>;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].type).toBe('line');
      if (tracks[0].type === 'line') {
        expect(tracks[0].slope).toBe(Infinity);
      }
    });
  });
});
