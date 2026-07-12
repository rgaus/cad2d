import {
  ColinearConstraint,
  ConstrainedTrack,
  ConstraintEndpoint,
  HorizontalConstraint,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  VerticalConstraint,
} from '@/lib/geometry';
import type { ConstraintEndpoint as ConstraintEndpointType } from '@/lib/geometry';
import { Vector2 } from '@/lib/math';
import { InchesLength } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function resolveEndpoint(ep: ConstraintEndpointType): SheetPosition {
  if (ep.type === 'point') {
    return ep.point;
  }
  throw new Error('Test resolver only supports point endpoints');
}

describe('LinearConstraint.isInConflict', () => {
  const sheetDefaultUnit = 'in' as const;

  it('returns false when full distance matches target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        new InchesLength(5),
      ),
      id: 'c1',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(
      false,
    );
  });

  it('returns true when full distance differs from target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(10, 0)),
        new InchesLength(5),
      ),
      id: 'c2',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(true);
  });

  it('returns false when x-axis distance matches target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 3)),
        new InchesLength(5),
        { axis: 'x' },
      ),
      id: 'c3',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(
      false,
    );
  });

  it('returns true when x-axis distance differs from target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(10, 0)),
        new InchesLength(5),
        { axis: 'x' },
      ),
      id: 'c4',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(true);
  });

  it('returns false when y-axis distance matches target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(3, 5)),
        new InchesLength(5),
        { axis: 'y' },
      ),
      id: 'c5',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(
      false,
    );
  });

  it('returns true when y-axis distance differs from target', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 10)),
        new InchesLength(5),
        { axis: 'y' },
      ),
      id: 'c6',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(true);
  });

  it('returns false when difference is within epsilon', () => {
    const constraint = {
      ...LinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5.0005, 0)),
        new InchesLength(5),
      ),
      id: 'c7',
    };
    expect(LinearConstraint.isInConflict(constraint, resolveEndpoint, sheetDefaultUnit)).toBe(
      false,
    );
  });
});

describe('HorizontalConstraint.isInConflict', () => {
  it('returns false when points have same y', () => {
    const constraint = {
      ...HorizontalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
      ),
      id: 'h1',
    };
    expect(HorizontalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when points have different y', () => {
    const constraint = {
      ...HorizontalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 1)),
      ),
      id: 'h2',
    };
    expect(HorizontalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns false when dy is within epsilon', () => {
    const constraint = {
      ...HorizontalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0.0005)),
      ),
      id: 'h3',
    };
    expect(HorizontalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });
});

describe('VerticalConstraint.isInConflict', () => {
  it('returns false when points have same x', () => {
    const constraint = {
      ...VerticalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 5)),
      ),
      id: 'v1',
    };
    expect(VerticalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when points have different x', () => {
    const constraint = {
      ...VerticalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(1, 5)),
      ),
      id: 'v2',
    };
    expect(VerticalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns false when dx is within epsilon', () => {
    const constraint = {
      ...VerticalConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(0.0005, 5)),
      ),
      id: 'v3',
    };
    expect(VerticalConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });
});

describe('PerpendicularConstraint.isInConflict', () => {
  it('returns false when segments are perpendicular (90 degrees)', () => {
    const constraint = {
      ...PerpendicularConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 5)),
      ),
      id: 'p1',
    };
    expect(PerpendicularConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when segments are not perpendicular (45 degrees)', () => {
    const constraint = {
      ...PerpendicularConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 5)),
        ConstraintEndpoint.point(new SheetPosition(10, 5)),
      ),
      id: 'p2',
    };
    expect(PerpendicularConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns false when segments are near-perpendicular within epsilon', () => {
    const constraint = {
      ...PerpendicularConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(5.00005, 5)),
      ),
      id: 'p3',
    };
    expect(PerpendicularConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when segments are colinear (0 degrees)', () => {
    const constraint = {
      ...PerpendicularConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(10, 0)),
      ),
      id: 'p4',
    };
    expect(PerpendicularConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns true when segments are opposite (180 degrees)', () => {
    const constraint = {
      ...PerpendicularConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(10, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
      ),
      id: 'p5',
    };
    expect(PerpendicularConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });
});

describe('ParallelConstraint.isInConflict', () => {
  it('returns false when segments are parallel', () => {
    const constraint = {
      ...ParallelConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 3)),
        ConstraintEndpoint.point(new SheetPosition(5, 3)),
      ),
      id: 'par1',
    };
    expect(ParallelConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when segments are not parallel', () => {
    const constraint = {
      ...ParallelConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 5)),
      ),
      id: 'par2',
    };
    expect(ParallelConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns false when segments are nearly parallel within epsilon', () => {
    const constraint = {
      ...ParallelConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 3)),
        ConstraintEndpoint.point(new SheetPosition(5, 3.0001)),
      ),
      id: 'par3',
    };
    expect(ParallelConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });
});

describe('ColinearConstraint.isInConflict', () => {
  it('returns false when target point lies on the line', () => {
    const constraint = {
      ...ColinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(3, 0)),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
      ),
      id: 'col1',
    };
    expect(ColinearConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });

  it('returns true when target point is off the line', () => {
    const constraint = {
      ...ColinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(3, 1)),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
      ),
      id: 'col2',
    };
    expect(ColinearConstraint.isInConflict(constraint, resolveEndpoint)).toBe(true);
  });

  it('returns false when target is within epsilon of the line', () => {
    const constraint = {
      ...ColinearConstraint.create(
        ConstraintEndpoint.point(new SheetPosition(3, 0.0001)),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        ConstraintEndpoint.point(new SheetPosition(5, 0)),
      ),
      id: 'col3',
    };
    expect(ColinearConstraint.isInConflict(constraint, resolveEndpoint)).toBe(false);
  });
});

describe('ConstrainedTrack.closestPointOnTracks', () => {
  it('returns null for empty array', () => {
    expect(ConstrainedTrack.closestPointOnTracks([], new SheetPosition(0, 0))).toBeNull();
  });

  describe('point tracks', () => {
    it('returns the point itself', () => {
      const point = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'point', point: new SheetPosition(3, 4) }],
        new SheetPosition(0, 0),
      );
      expect(point!.x).toBeCloseTo(3);
      expect(point!.y).toBeCloseTo(4);
    });

    it('prefers the closest point track among multiple', () => {
      const point = ConstrainedTrack.closestPointOnTracks(
        [
          { type: 'point', point: new SheetPosition(10, 0) },
          { type: 'point', point: new SheetPosition(1, 0) },
          { type: 'point', point: new SheetPosition(100, 0) },
        ],
        new SheetPosition(0, 0),
      );
      expect(point!.x).toBeCloseTo(1);
      expect(point!.y).toBeCloseTo(0);
    });
  });

  describe('line tracks', () => {
    it('finds closest on a horizontal line', () => {
      const q = new SheetPosition(3, 10);
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'line', point: new SheetPosition(0, 5), slope: 0 }],
        q,
      );
      expect(result!.x).toBeCloseTo(3);
      expect(result!.y).toBeCloseTo(5);
    });

    it('finds closest on a vertical line', () => {
      const q = new SheetPosition(10, 7);
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'line', point: new SheetPosition(4, 0), slope: Infinity }],
        q,
      );
      expect(result!.x).toBeCloseTo(4);
      expect(result!.y).toBeCloseTo(7);
    });

    it('finds closest on a diagonal line', () => {
      // line y = x through (0, 0)
      const q = new SheetPosition(0, 10);
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'line', point: new SheetPosition(0, 0), slope: 1 }],
        q,
      );
      // Closest point on y=x to (0, 10) is (5, 5)
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(5);
    });
  });

  describe('circle tracks', () => {
    it('finds closest when query is outside the circle', () => {
      // Circle centered at (0, 0) radius 5, query at (10, 0)
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'circle', center: new SheetPosition(0, 0), radius: 5 }],
        new SheetPosition(10, 0),
      );
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(0);
    });

    it('finds closest when query is inside the circle', () => {
      // Circle centered at (0, 0) radius 10, query at (0, 3)
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'circle', center: new SheetPosition(0, 0), radius: 10 }],
        new SheetPosition(0, 3),
      );
      // Closest is radially outward from center through query
      expect(result!.x).toBeCloseTo(0);
      expect(result!.y).toBeCloseTo(10);
    });

    it('handles query exactly at circle center', () => {
      const result = ConstrainedTrack.closestPointOnTracks(
        [{ type: 'circle', center: new SheetPosition(2, 3), radius: 7 }],
        new SheetPosition(2, 3),
      );
      // Any point on the circle is valid; distance should be exactly radius
      const dist = Vector2.distance(result!, new SheetPosition(2, 3));
      expect(dist).toBeCloseTo(7, 5);
    });
  });

  describe('or tracks', () => {
    it('recurses into inner tracks and picks closest', () => {
      const result = ConstrainedTrack.closestPointOnTracks(
        [
          {
            type: 'or' as const,
            inner: [
              { type: 'point', point: new SheetPosition(100, 100) },
              { type: 'point', point: new SheetPosition(5, 0) },
            ],
          },
        ],
        new SheetPosition(0, 0),
      );
      expect(result!.x).toBeCloseTo(5);
      expect(result!.y).toBeCloseTo(0);
    });
  });

  describe('mixed tracks', () => {
    it('picks the globally closest among point, line, and circle', () => {
      const result = ConstrainedTrack.closestPointOnTracks(
        [
          { type: 'point', point: new SheetPosition(20, 0) },
          { type: 'line', point: new SheetPosition(0, 10), slope: 0 },
          { type: 'circle', center: new SheetPosition(0, 0), radius: 3 },
        ],
        new SheetPosition(0, 0),
      );
      // Closest is the circle (distance 3 from center)
      expect(Vector2.distance(result!, new SheetPosition(0, 0))).toBeCloseTo(3, 5);
    });
  });
});
