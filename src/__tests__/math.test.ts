import { SheetPosition } from '../lib/viewport/types';
import { DeCasteljau, ellipseToPolygon, rectangleToPolygon, cubicBezierAt } from '../lib/math';

describe('DeCasteljau.splitQuadraticBezier', () => {
  it('split at t=0.5 produces left curve ending at midpoint', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(5, 10);
    const p2 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitQuadraticBezier(p0, p1, p2, 0.5);

    expect(left.type).toBe('arc-quadratic');
    expect(right.type).toBe('arc-quadratic');

    expect(left.point.x).toBeCloseTo(5, 5);
    expect(left.point.y).toBeCloseTo(5, 5);
    expect(right.point.x).toBeCloseTo(10, 5);
    expect(right.point.y).toBeCloseTo(0, 5);

    expect(left.controlPoint.x).toBeCloseTo(2.5, 5);
    expect(left.controlPoint.y).toBeCloseTo(5, 5);
    expect(right.controlPoint.x).toBeCloseTo(7.5, 5);
    expect(right.controlPoint.y).toBeCloseTo(5, 5);
  });

  it('split at t=0.25 produces correct left curve', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(8, 4);
    const p2 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitQuadraticBezier(p0, p1, p2, 0.25);

    expect(left.point.x).toBeCloseTo(3.625, 3);
    expect(left.point.y).toBeCloseTo(1.5, 3);
    expect(right.point.x).toBeCloseTo(10, 5);
    expect(right.point.y).toBeCloseTo(0, 5);
  });

  it('split at t=0.75 produces correct left curve', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(2, 6);
    const p2 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitQuadraticBezier(p0, p1, p2, 0.75);

    expect(left.point.x).toBeCloseTo(6.375, 3);
    expect(left.point.y).toBeCloseTo(2.25, 3);
    expect(right.point.x).toBeCloseTo(10, 5);
    expect(right.point.y).toBeCloseTo(0, 5);
  });

  it('split at t=0.1 produces left curve near p0', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(50, 25);
    const p2 = new SheetPosition(100, 0);

    const [left, right] = DeCasteljau.splitQuadraticBezier(p0, p1, p2, 0.1);

    expect(left.point.x).toBeCloseTo(10, 0);
    expect(left.point.y).toBeCloseTo(4.5, 3);
  });

  it('split at t=0.9 produces right curve near p2', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(50, 25);
    const p2 = new SheetPosition(100, 0);

    const [left, right] = DeCasteljau.splitQuadraticBezier(p0, p1, p2, 0.9);

    expect(right.point.x).toBeCloseTo(100, 5);
    expect(right.point.y).toBeCloseTo(0, 5);
  });
});

describe('DeCasteljau.splitCubicBezier', () => {
  it('split at t=0.5 produces left curve ending at midpoint', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 10);
    const p2 = new SheetPosition(10, 10);
    const p3 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.5);

    expect(left.type).toBe('arc-cubic');
    expect(right.type).toBe('arc-cubic');

    expect(left.point.x).toBeCloseTo(5, 5);
    expect(left.point.y).toBeCloseTo(7.5, 5);
    expect(right.point.x).toBeCloseTo(10, 5);
    expect(right.point.y).toBeCloseTo(0, 5);

    expect(left.controlPointA.x).toBeCloseTo(0, 5);
    expect(left.controlPointA.y).toBeCloseTo(5, 5);
    expect(left.controlPointB.x).toBeCloseTo(2.5, 5);
    expect(left.controlPointB.y).toBeCloseTo(7.5, 5);

    expect(right.controlPointA.x).toBeCloseTo(7.5, 5);
    expect(right.controlPointA.y).toBeCloseTo(7.5, 5);
    expect(right.controlPointB.x).toBeCloseTo(10, 5);
    expect(right.controlPointB.y).toBeCloseTo(5, 5);
  });

  it('split at t=0.25 produces left curve near start', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 20);
    const p2 = new SheetPosition(20, 20);
    const p3 = new SheetPosition(20, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.25);

    expect(left.point.x).toBeCloseTo(3.125, 3);
    expect(left.point.y).toBeCloseTo(11.25, 3);
  });

  it('split point on original curve equals left curve endpoint', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 10);
    const p2 = new SheetPosition(10, 10);
    const p3 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.5);

    const midpointOnOriginal = cubicBezierAt(p0, p1, p2, p3, 0.5);
    expect(left.point.x).toBeCloseTo(midpointOnOriginal.x, 5);
    expect(left.point.y).toBeCloseTo(midpointOnOriginal.y, 5);
  });

  it('right curve starts at split point when evaluated at local t=0', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 10);
    const p2 = new SheetPosition(10, 10);
    const p3 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.5);

    const startOfRight = cubicBezierAt(left.point, right.controlPointA, right.controlPointB, right.point, 0);
    expect(startOfRight.x).toBeCloseTo(left.point.x, 5);
    expect(startOfRight.y).toBeCloseTo(left.point.y, 5);
  });

  it('right curve ends at p3 when evaluated at local t=1', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 10);
    const p2 = new SheetPosition(10, 10);
    const p3 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.5);

    const endOfRight = cubicBezierAt(left.point, right.controlPointA, right.controlPointB, right.point, 1);
    expect(endOfRight.x).toBeCloseTo(p3.x, 5);
    expect(endOfRight.y).toBeCloseTo(p3.y, 5);
  });

  it('t near 0 produces minimal left curve near p0', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 100);
    const p2 = new SheetPosition(100, 100);
    const p3 = new SheetPosition(100, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.01);

    expect(left.point.x).toBeCloseTo(0.03, 2);
    expect(left.point.y).toBeCloseTo(2.97, 2);
  });

  it('t near 1 produces minimal right curve near p3', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(0, 100);
    const p2 = new SheetPosition(100, 100);
    const p3 = new SheetPosition(100, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.99);

    expect(right.point.x).toBeCloseTo(100, 5);
    expect(right.point.y).toBeCloseTo(0, 5);
  });

  it('handles straight line case (control points collinear)', () => {
    const p0 = new SheetPosition(0, 0);
    const p1 = new SheetPosition(3.33, 0);
    const p2 = new SheetPosition(6.67, 0);
    const p3 = new SheetPosition(10, 0);

    const [left, right] = DeCasteljau.splitCubicBezier(p0, p1, p2, p3, 0.5);

    expect(left.point.y).toBeCloseTo(0, 5);
    expect(right.point.y).toBeCloseTo(0, 5);
    expect(left.point.x).toBeCloseTo(5, 5);
    expect(right.point.x).toBeCloseTo(10, 5);
  });
});

describe('ellipseToPolygon', () => {
  it('converts circle to 7 segments (4 points + 3 arcs)', () => {
    const center = new SheetPosition(5, 5);
    const result = ellipseToPolygon(center, 5, 5);

    expect(result.length).toBe(7);
    expect(result[0].type).toBe('point');
    expect(result[1].type).toBe('arc-quadratic');
    expect(result[2].type).toBe('point');
    expect(result[3].type).toBe('arc-quadratic');
    expect(result[4].type).toBe('point');
    expect(result[5].type).toBe('arc-quadratic');
    expect(result[6].type).toBe('point');
  });

  it('circle control points are at correct offset', () => {
    const center = new SheetPosition(0, 0);
    const radius = 10;
    const result = ellipseToPolygon(center, radius, radius);

    const arcSegments = result.filter(s => s.type === 'arc-quadratic') as Array<{ controlPoint: SheetPosition }>;
    const k = 0.5522847498;

    expect(arcSegments[0].controlPoint.x).toBeCloseTo(radius * k, 5);
    expect(arcSegments[0].controlPoint.y).toBeCloseTo(-radius, 5);

    expect(arcSegments[1].controlPoint.x).toBeCloseTo(-radius, 5);
    expect(arcSegments[1].controlPoint.y).toBeCloseTo(-radius * k, 5);

    expect(arcSegments[2].controlPoint.x).toBeCloseTo(-radius * k, 5);
    expect(arcSegments[2].controlPoint.y).toBeCloseTo(radius, 5);
  });

  it('converts ellipse (rx != ry) to 7 segments', () => {
    const center = new SheetPosition(5, 5);
    const result = ellipseToPolygon(center, 8, 4);

    expect(result.length).toBe(7);
  });

  it('ellipse quadrant points are at correct positions', () => {
    const center = new SheetPosition(0, 0);
    const radiusX = 10;
    const radiusY = 5;
    const result = ellipseToPolygon(center, radiusX, radiusY);

    expect((result[0] as { point: SheetPosition }).point.x).toBeCloseTo(10, 5);
    expect((result[0] as { point: SheetPosition }).point.y).toBeCloseTo(0, 5);

    expect((result[2] as { point: SheetPosition }).point.x).toBeCloseTo(0, 5);
    expect((result[2] as { point: SheetPosition }).point.y).toBeCloseTo(-5, 5);

    expect((result[4] as { point: SheetPosition }).point.x).toBeCloseTo(-10, 5);
    expect((result[4] as { point: SheetPosition }).point.y).toBeCloseTo(0, 5);

    expect((result[6] as { point: SheetPosition }).point.x).toBeCloseTo(0, 5);
    expect((result[6] as { point: SheetPosition }).point.y).toBeCloseTo(5, 5);
  });

  it('polygon is not closed (start and end points differ)', () => {
    const center = new SheetPosition(5, 5);
    const result = ellipseToPolygon(center, 5, 5);

    const firstPoint = (result[0] as { point: SheetPosition }).point;
    const lastPoint = (result[6] as { point: SheetPosition }).point;
    expect(firstPoint.x).not.toBe(lastPoint.x);
    expect(firstPoint.y).not.toBe(lastPoint.y);
  });

  it('tiny difference between rx and ry still produces ellipse result', () => {
    const center = new SheetPosition(0, 0);
    const result = ellipseToPolygon(center, 10, 10.0001);

    expect(result.length).toBe(7);
  });
});

describe('rectangleToPolygon', () => {
  it('converts rectangle to 4 point segments', () => {
    const upperLeft = new SheetPosition(0, 0);
    const lowerRight = new SheetPosition(10, 10);
    const result = rectangleToPolygon(upperLeft, lowerRight);

    expect(result.length).toBe(4);
    for (const seg of result) {
      expect(seg.type).toBe('point');
    }
  });

  it('returns points in correct order', () => {
    const upperLeft = new SheetPosition(0, 0);
    const lowerRight = new SheetPosition(10, 10);
    const result = rectangleToPolygon(upperLeft, lowerRight);

    expect(result[0].point.x).toBeCloseTo(0, 5);
    expect(result[0].point.y).toBeCloseTo(0, 5);

    expect(result[1].point.x).toBeCloseTo(10, 5);
    expect(result[1].point.y).toBeCloseTo(0, 5);

    expect(result[2].point.x).toBeCloseTo(10, 5);
    expect(result[2].point.y).toBeCloseTo(10, 5);

    expect(result[3].point.x).toBeCloseTo(0, 5);
    expect(result[3].point.y).toBeCloseTo(10, 5);
  });

  it('handles non-square rectangle', () => {
    const upperLeft = new SheetPosition(2, 3);
    const lowerRight = new SheetPosition(7, 11);
    const result = rectangleToPolygon(upperLeft, lowerRight);

    expect(result[1].point.x).toBeCloseTo(7, 5);
    expect(result[1].point.y).toBeCloseTo(3, 5);

    expect(result[3].point.x).toBeCloseTo(2, 5);
    expect(result[3].point.y).toBeCloseTo(11, 5);
  });

  it('handles negative coordinates', () => {
    const upperLeft = new SheetPosition(-5, -10);
    const lowerRight = new SheetPosition(5, 10);
    const result = rectangleToPolygon(upperLeft, lowerRight);

    expect(result[0].point.x).toBeCloseTo(-5, 5);
    expect(result[2].point.y).toBeCloseTo(10, 5);
  });

  it('polygon is not closed (only 3 of 4 sides represented)', () => {
    const upperLeft = new SheetPosition(0, 0);
    const lowerRight = new SheetPosition(10, 10);
    const result = rectangleToPolygon(upperLeft, lowerRight);

    expect(result.length).toBe(4);
    expect((result[0] as { point: SheetPosition }).point.x).toBeCloseTo(0, 5);
    expect((result[0] as { point: SheetPosition }).point.y).toBeCloseTo(0, 5);
    expect((result[3] as { point: SheetPosition }).point.x).toBeCloseTo(0, 5);
    expect((result[3] as { point: SheetPosition }).point.y).toBeCloseTo(10, 5);
  });
});
