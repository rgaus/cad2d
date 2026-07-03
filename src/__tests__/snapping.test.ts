import {
  type ConstrainedTrack,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  LinearConstraint,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  type KeyPointSnappingOptions,
  type SnappingOptions,
  applyKeyPointSnapping,
  applySnappingOnConstrainedTrack,
} from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

const defaultOptions: SnappingOptions = {
  primaryGridSize: 1,
  secondaryGridSize: null,
  ctrlHeld: false,
  superHeld: false,
};

const ctrlOptions: SnappingOptions = { ...defaultOptions, ctrlHeld: true };

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
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], defaultOptions, 1e-10);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('behaves like applySnapping when track list is empty (ctrl bypasses grid)', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], ctrlOptions, 1e-10);
      expect(result.x).toBeCloseTo(0.3);
      expect(result.y).toBeCloseTo(0.7);
    });
  });

  describe('single circle track', () => {
    it('snaps to the nearest point on the circle perimeter', () => {
      // Circle at (0,0) radius 5. Input (8,0).
      // Projection: (5, 0). snapDist = |8-5| = 3.
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [circle(pt(0, 0), 5)],
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });

    it('snaps a point inside the circle outward to the perimeter', () => {
      // Circle at (0,0) radius 5. Input (-2, 0) is inside.
      // Projection: (-5, 0). snapDist = |2-5| = 3.
      const result = applySnappingOnConstrainedTrack(
        pt(-2, 0),
        [circle(pt(0, 0), 5)],
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(-5);
      expect(result.y).toBeCloseTo(0);
    });

    it('stays put when the point is already on the perimeter', () => {
      // Point (3,4) is on circle(0,0,5).
      const result = applySnappingOnConstrainedTrack(
        pt(3, 4),
        [circle(pt(0, 0), 5)],
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(4);
    });

    it('skips the circle when point is exactly at the center (no unique projection)', () => {
      // Center → can't project, falls back to grid-snapped pos
      const result = applySnappingOnConstrainedTrack(
        pt(0, 0),
        [circle(pt(0, 0), 5)],
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('single point track', () => {
    it('snaps to the point', () => {
      const result = applySnappingOnConstrainedTrack(
        pt(8, 0),
        [point(pt(3, 4))],
        ctrlOptions,
        1e-10,
      );
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
        ctrlOptions,
        1e-10,
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
        ctrlOptions,
        1e-10,
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
        ctrlOptions,
        1e-10,
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
        ctrlOptions,
        1e-10,
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
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(6);
      expect(result.y).toBeCloseTo(0);
    });

    it('when all circles are at centers, falls back to grid-snapped position', () => {
      // Two circles, both at center positions that can't be projected
      const result = applySnappingOnConstrainedTrack(
        pt(0, 0),
        [circle(pt(0, 0), 5), circle(pt(0, 0), 10)],
        ctrlOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('grid snap applies before track snap', () => {
    it('grid-snaps then snaps to the nearest track', () => {
      // primaryGridSize=1, no ctrl
      // Input (3.3, 4.7) → grid-snapped to (3, 5)
      // Then snap to circle(0,0,5): dx=3, dy=5, dist≈5.83, snapDist≈0.83
      // Target: (0 + 3/5.83*5, 0 + 5/5.83*5) ≈ (2.57, 4.29)
      const result = applySnappingOnConstrainedTrack(
        pt(3.3, 4.7),
        [circle(pt(0, 0), 5)],
        defaultOptions,
        1e-10,
      );
      // Verify it's on the circle perimeter
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(5, 5);
      // Verify it's not the raw grid snap point (grid snap alone would give (3,5))
      expect(result.x).not.toBeCloseTo(3);
    });

    it('ctrl held bypasses grid snap before track snap', () => {
      // ctrl=held, input (3.3, 4.7) stays as-is
      // Then snap to circle(0,0,5): dx=3.3, dy=4.7, dist≈5.74, snapDist≈0.74
      // Target: (0 + 3.3/5.74*5, 0 + 4.7/5.74*5) ≈ (2.87, 4.09)
      const result = applySnappingOnConstrainedTrack(
        pt(3.3, 4.7),
        [circle(pt(0, 0), 5)],
        ctrlOptions,
        1e-10,
      );
      const dist = Math.sqrt(result.x * result.x + result.y * result.y);
      expect(dist).toBeCloseTo(5, 5);
    });
  });

  describe('union type inputs', () => {
    it('returns pos unchanged when passed immobile', () => {
      const result = applySnappingOnConstrainedTrack(
        pt(3.3, 4.7),
        'immobile',
        defaultOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(3.3);
      expect(result.y).toBeCloseTo(4.7);
    });

    it('behaves like applySnapping when passed unconstrained', () => {
      const result = applySnappingOnConstrainedTrack(
        pt(0.3, 0.7),
        'unconstrained',
        defaultOptions,
        1e-10,
      );
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(1);
    });

    it('behaves like applySnapping when passed empty array', () => {
      const result = applySnappingOnConstrainedTrack(pt(0.3, 0.7), [], defaultOptions, 1e-10);
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
      const result = applySnappingOnConstrainedTrack(pt(6, 3), [orTrack], ctrlOptions, 1e-10);
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
      const result = applySnappingOnConstrainedTrack(pt(4, 0), [orTrack], ctrlOptions, 1e-10);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('circle track with 15-degree angle snap', () => {
    it('snaps the circle target to nearest 15-degree radial when ctrl is not held', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 3) — angle ~16.7deg, nearest 15deg is 15deg (0.262 rad)
      const result = applySnappingOnConstrainedTrack(pt(10, 3), [c], defaultOptions, 1e-10);
      const expectedX = 10 * Math.cos((15 * Math.PI) / 180);
      const expectedY = 10 * Math.sin((15 * Math.PI) / 180);
      expect(result.x).toBeCloseTo(expectedX);
      expect(result.y).toBeCloseTo(expectedY);
    });

    it('snaps to 0 degrees when the angle is closer to 0 than 15', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 0.5) — angle ~2.86deg, nearest 15deg is 0deg
      const result = applySnappingOnConstrainedTrack(pt(10, 0.5), [c], defaultOptions, 1e-10);
      expect(result.x).toBeCloseTo(10);
      expect(result.y).toBeCloseTo(0);
    });

    it('does not apply angle snap when ctrl is held', () => {
      const c = circle(pt(0, 0), 10);
      // Mouse at (10, 3) — angle ~16.7deg, ctrl held: no snap
      const result = applySnappingOnConstrainedTrack(pt(10, 3), [c], ctrlOptions, 1e-10);
      const angle = Math.atan2(3, 10);
      const expectedX = 10 * Math.cos(angle);
      const expectedY = 10 * Math.sin(angle);
      expect(result.x).toBeCloseTo(expectedX);
      expect(result.y).toBeCloseTo(expectedY);
    });
  });

  describe('line track with perpendicular grid snap', () => {
    it('horizontal line snaps projected x to grid when ctrl is not held', () => {
      const l = line(pt(0, 5), 0);
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], defaultOptions, 1e-10);
      expect(result.x).toBeCloseTo(3);
      expect(result.y).toBeCloseTo(5);
    });

    it('horizontal line respects secondary grid for x snap', () => {
      const l = line(pt(0, 5), 0);
      const options: SnappingOptions = {
        ...defaultOptions,
        secondaryGridSize: 0.5,
      };
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], options, 1e-10);
      expect(result.x).toBeCloseTo(3.5);
      expect(result.y).toBeCloseTo(5);
    });

    it('horizontal line does not grid-snap x when ctrl is held', () => {
      const l = line(pt(0, 5), 0);
      const result = applySnappingOnConstrainedTrack(pt(3.3, 4.9), [l], ctrlOptions, 1e-10);
      expect(result.x).toBeCloseTo(3.3);
      expect(result.y).toBeCloseTo(5);
    });

    it('vertical line snaps projected y to grid when ctrl is not held', () => {
      const l = line(pt(5, 0), Infinity);
      const result = applySnappingOnConstrainedTrack(pt(4.9, 3.3), [l], defaultOptions, 1e-10);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(3);
    });

    it('vertical line does not grid-snap y when ctrl is held', () => {
      const l = line(pt(5, 0), Infinity);
      const result = applySnappingOnConstrainedTrack(pt(4.9, 3.3), [l], ctrlOptions, 1e-10);
      expect(result.x).toBeCloseTo(5);
      expect(result.y).toBeCloseTo(3.3);
    });

    it('sloped line does not apply perpendicular grid snap', () => {
      const l = line(pt(0, 0), 1);
      const result = applySnappingOnConstrainedTrack(pt(4, 0), [l], defaultOptions, 1e-10);
      expect(result.x).toBeCloseTo(2);
      expect(result.y).toBeCloseTo(2);
    });

    it('point track does not apply extra snap regardless of ctrl', () => {
      const p = point(pt(5, 5));
      const resultNoCtrl = applySnappingOnConstrainedTrack(pt(5, 5), [p], defaultOptions, 1e-10);
      const resultCtrl = applySnappingOnConstrainedTrack(pt(5, 5), [p], ctrlOptions, 1e-10);
      expect(resultNoCtrl.x).toBeCloseTo(5);
      expect(resultNoCtrl.y).toBeCloseTo(5);
      expect(resultCtrl.x).toBeCloseTo(5);
      expect(resultCtrl.y).toBeCloseTo(5);
    });
  });
});

/**
 * Helper to construct a full Rectangle geometry from corner coordinates.
 */
function makeRect(id: string, x1: number, y1: number, x2: number, y2: number): Rectangle {
  const template = Rectangle.create(new SheetPosition(x1, y1), new SheetPosition(x2, y2), {
    fillColor: null,
    linkDimensions: false,
  });
  return {
    id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(0),
    },
  };
}

function makeDatum(id: string, x: number, y: number): Datum {
  const template = Datum.create(new SheetPosition(x, y));
  return {
    id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(0),
    },
  };
}

describe('applyKeyPointSnapping', () => {
  /**
   * The bug (c5e5145): applyKeyPointSnapping was passing the already-grid-snapped
   * position to snapNearestKeyPoint instead of the original cursor position.
   * When the grid size was large enough, the grid-snapped position could be
   * farther from a key point than the threshold, even though the raw cursor
   * was directly on top of it. The fix passes the raw `pos` to snapNearestKeyPoint.
   */
  it('snaps to key point even when grid snap would move the cursor far away', () => {
    // Rectangle with upper-left at (3, 3).
    const rect = makeRect('rect', 3, 3, 8, 8);
    const options: KeyPointSnappingOptions = {
      viewportScale: 1,
      // Large grid size: grid snap of (3.04, 3.04) → (5, 5), distance ≈ 2.83.
      primaryGridSize: 5,
      secondaryGridSize: null,
      superHeld: false,
      rectangles: [rect],
      ellipses: [],
      polygons: [],
      constraints: [],
      datums: [],
    };

    // Mouse at (3.04, 3.04): 0.057 away from upperLeft at (3, 3).
    // Key point threshold = 8 px / (64 px/unit × 1) = 0.125 sheet units.
    // Raw distance (0.057) < threshold (0.125) → should snap.
    // Old bug: used gridSnapped (5, 5) → distance to upperLeft ≈ 2.83 > 0.125 → no snap.
    const { endpoint: result, shouldCreateDatum } = applyKeyPointSnapping(
      new SheetPosition(3.04, 3.04),
      /* ctrlHeld */ false,
      options,
    );

    expect(shouldCreateDatum).toBeNull();
    expect(result.type).toBe('locked-rectangle');
    if (result.type === 'locked-rectangle') {
      expect(result.id).toBe('rect');
      expect(result.point).toBe('upperLeft');
    }
  });

  it('returns a free point when no key point is within threshold', () => {
    const rect = makeRect('rect', 10, 10, 20, 20);
    const options: KeyPointSnappingOptions = {
      viewportScale: 1,
      primaryGridSize: 1,
      secondaryGridSize: null,
      superHeld: false,
      rectangles: [rect],
      ellipses: [],
      polygons: [],
      constraints: [],
      datums: [],
    };

    // Mouse at (13, 13) — the rectangle's key points are at x∈{10, 15, 20},
    // y∈{10, 15, 20} (four corners + center). The closest is the center at
    // (15, 15), which is ~2.83 away — well beyond the 0.125 sheet-unit threshold.
    const { endpoint: result, shouldCreateDatum } = applyKeyPointSnapping(
      new SheetPosition(13, 13),
      /* ctrlHeld */ false,
      options,
    );

    expect(shouldCreateDatum).toBeNull();
    expect(result.type).toBe('point');
  });

  it('returns grid-snapped free point when ctrl is held', () => {
    const rect = makeRect('rect', 0, 0, 5, 5);
    const options: KeyPointSnappingOptions = {
      viewportScale: 1,
      primaryGridSize: 1,
      secondaryGridSize: null,
      superHeld: false,
      rectangles: [rect],
      ellipses: [],
      polygons: [],
      constraints: [],
      datums: [],
    };

    // Ctrl held bypasses key point snap but grid snap still applies to the
    // returned free-point position.
    const { endpoint: result, shouldCreateDatum } = applyKeyPointSnapping(
      new SheetPosition(0.3, 0.7),
      /* ctrlHeld */ true,
      options,
    );

    expect(shouldCreateDatum).toBeNull();
    expect(result.type).toBe('point');
    if (result.type === 'point') {
      expect(result.point.x).toBeCloseTo(0.3);
      expect(result.point.y).toBeCloseTo(0.7);
    }
  });

  it('snaps to an existing datum point', () => {
    const datum = makeDatum(`${ID_PREFIXES.datum}_1`, 5, 5);
    const options: KeyPointSnappingOptions = {
      viewportScale: 1,
      primaryGridSize: 1,
      secondaryGridSize: null,
      superHeld: false,
      rectangles: [],
      ellipses: [],
      polygons: [],
      constraints: [],
      datums: [datum],
    };

    // Cursor at (5.02, 5) — 0.02 away from datum at (5, 5), well within 0.125 threshold
    const { endpoint: result, shouldCreateDatum } = applyKeyPointSnapping(
      new SheetPosition(5.02, 5),
      /* ctrlHeld */ false,
      options,
    );

    expect(shouldCreateDatum).toBeNull();
    expect(result.type).toStrictEqual('locked-datum');
    if (result.type === 'locked-datum') {
      expect(result.id).toStrictEqual(`${ID_PREFIXES.datum}_1`);
    }
  });

  it('returns shouldCreateDatum when cursor is near a constraint free endpoint', () => {
    const options: KeyPointSnappingOptions = {
      viewportScale: 1,
      primaryGridSize: 1,
      secondaryGridSize: null,
      superHeld: false,
      rectangles: [],
      ellipses: [],
      polygons: [],
      constraints: [
        {
          ...LinearConstraint.create(
            ConstraintEndpoint.point(new SheetPosition(2, 5)),
            ConstraintEndpoint.point(new SheetPosition(5, 5)),
            Length.centimeters(3),
          ),
          id: `${ID_PREFIXES.constraint}_1`,
        },
      ],
      datums: [],
    };

    // Cursor at (5.02, 5) — near pointB of cns_1 at (5, 5)
    const { endpoint: result, shouldCreateDatum } = applyKeyPointSnapping(
      new SheetPosition(5.02, 5),
      /* ctrlHeld */ false,
      options,
    );

    expect(shouldCreateDatum).not.toBeNull();
    expect(shouldCreateDatum!.constraintId).toBe(`${ID_PREFIXES.constraint}_1`);
    expect(shouldCreateDatum!.key).toBe('pointB');
    expect(shouldCreateDatum!.position).toEqual(new SheetPosition(5, 5));
    // The endpoint should be a placeholder point, not locked-datum (datum creation
    // is deferred to the caller)
    expect(result.type).toBe('point');
  });
});
