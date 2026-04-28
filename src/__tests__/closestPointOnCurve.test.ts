import { SheetPosition } from '../lib/viewport/types';
import { closestPointOnQuadraticCurve, closestPointOnCubicCurve, DeCasteljau } from '../lib/math';

describe('closestPointOnQuadraticCurve', () => {
  it('returns endpoint when query is at start', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(0, 0));
    expect(result.point.x).toBeCloseTo(0, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(0, 5);
  });

  it('returns endpoint when query is at end', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(10, 0));
    expect(result.point.x).toBeCloseTo(10, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(1, 5);
  });

  it('finds midpoint when query is directly above a symmetric curve', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(5, 8));
    expect(result.t).toBeCloseTo(0.5, 2);
  });

  it('finds closest point on a curve with query point off the curve', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(5, 2));
    expect(result.t).toBeGreaterThan(0.2);
    expect(result.t).toBeLessThan(0.8);
  });

  it('handles degenerate curve where control points coincide with endpoints', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(0, 0),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(5, 5));
    expect(result.point.x).toBeCloseTo(5, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
  });

  it('handles a straight line curve (collinear control point)', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 0),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(5, 5));
    expect(result.point.x).toBeCloseTo(5, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(0.5, 2);
  });

  it('returns distance that matches actual point distance', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const query = new SheetPosition(3, 2);
    const result = closestPointOnQuadraticCurve(curve, query);
    const dx = result.point.x - query.x;
    const dy = result.point.y - query.y;
    const computedDist = Math.sqrt(dx * dx + dy * dy);
    expect(result.distance).toBeCloseTo(computedDist, 5);
  });

  it('works with query point very close to one end', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnQuadraticCurve(curve, new SheetPosition(0.1, 0.1));
    expect(result.t).toBeLessThan(0.2);
  });
});

describe('closestPointOnCubicCurve', () => {
  it('returns endpoint when query is at start', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(0, 0));
    expect(result.point.x).toBeCloseTo(0, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(0, 5);
  });

  it('returns endpoint when query is at end', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(10, 0));
    expect(result.point.x).toBeCloseTo(10, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(1, 5);
  });

  it('finds closest point on a simple S-curve', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 10),
      controlPointB: new SheetPosition(10, -10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(5, 0));
    expect(result.t).toBeCloseTo(0.5, 2);
  });

  it('finds closest point on a curve with query point off the curve', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(5, -5));
    expect(result.t).toBeGreaterThan(0.2);
    expect(result.t).toBeLessThan(0.8);
  });

  it('handles degenerate curve where control points coincide with endpoints', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 0),
      controlPointB: new SheetPosition(10, 0),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(5, 5));
    expect(result.point.x).toBeCloseTo(5, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
  });

  it('handles a straight line curve (collinear control points)', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(3, 0),
      controlPointB: new SheetPosition(7, 0),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(5, 5));
    expect(result.point.x).toBeCloseTo(5, 5);
    expect(result.point.y).toBeCloseTo(0, 5);
    expect(result.t).toBeCloseTo(0.5, 2);
  });

  it('returns distance that matches actual point distance', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const query = new SheetPosition(3, 2);
    const result = closestPointOnCubicCurve(curve, query);
    const dx = result.point.x - query.x;
    const dy = result.point.y - query.y;
    const computedDist = Math.sqrt(dx * dx + dy * dy);
    expect(result.distance).toBeCloseTo(computedDist, 5);
  });

  it('works with query point very close to one end', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(0.1, 0.1));
    expect(result.t).toBeLessThan(0.2);
  });

  it('finds correct t on an asymmetric curve', () => {
    const curve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(1, 10),
      controlPointB: new SheetPosition(9, 10),
      end: new SheetPosition(10, 0),
    };
    const result = closestPointOnCubicCurve(curve, new SheetPosition(10, 0));
    expect(result.t).toBeCloseTo(1, 3);
  });
});

describe('DeCasteljau split functions work correctly with closestPointOnCurve results', () => {
  it('splitting at t=0.5 produces curves whose combined shape matches the original', () => {
    const quadCurve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const [left, right] = DeCasteljau.splitQuadraticBezier(quadCurve, 0.5);

    expect(left.start).toEqual(quadCurve.start);
    expect(left.end).toEqual(right.start);
    expect(right.end).toEqual(quadCurve.end);

    const midPoint = DeCasteljau.getQuadraticBezierPointAt(quadCurve, 0.5);
    expect(left.end.x).toBeCloseTo(midPoint.x, 10);
    expect(left.end.y).toBeCloseTo(midPoint.y, 10);
    expect(right.start.x).toBeCloseTo(midPoint.x, 10);
    expect(right.start.y).toBeCloseTo(midPoint.y, 10);
  });

  it('cubic split at t=0.5 produces curves whose combined shape matches the original', () => {
    const cubicCurve = {
      start: new SheetPosition(0, 0),
      controlPointA: new SheetPosition(0, 5),
      controlPointB: new SheetPosition(10, 5),
      end: new SheetPosition(10, 0),
    };
    const [left, right] = DeCasteljau.splitCubicBezier(cubicCurve, 0.5);

    expect(left.start).toEqual(cubicCurve.start);
    expect(left.end).toEqual(right.start);
    expect(right.end).toEqual(cubicCurve.end);

    const midPoint = DeCasteljau.getCubicBezierPointAt(cubicCurve, 0.5);
    expect(left.end.x).toBeCloseTo(midPoint.x, 10);
    expect(left.end.y).toBeCloseTo(midPoint.y, 10);
    expect(right.start.x).toBeCloseTo(midPoint.x, 10);
    expect(right.start.y).toBeCloseTo(midPoint.y, 10);
  });

  it('inserting a point by splitting at t from closestPointOnCurve', () => {
    const quadCurve = {
      start: new SheetPosition(0, 0),
      controlPoint: new SheetPosition(5, 10),
      end: new SheetPosition(10, 0),
    };
    const queryPoint = new SheetPosition(5, 8);
    const { t } = closestPointOnQuadraticCurve(quadCurve, queryPoint);
    const [left, right] = DeCasteljau.splitQuadraticBezier(quadCurve, t);

    const leftPoint = DeCasteljau.getQuadraticBezierPointAt(left, 1);
    const rightPoint = DeCasteljau.getQuadraticBezierPointAt(right, 0);
    expect(leftPoint.x).toBeCloseTo(rightPoint.x, 10);
    expect(leftPoint.y).toBeCloseTo(rightPoint.y, 10);
  });
});