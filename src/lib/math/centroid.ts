import { type Position } from '@/lib/viewport/types';

/**
 * Computes the area centroid (center of mass) of a polygon defined by `points`, using the shoelace
 * formula: https://en.wikipedia.org/wiki/Centroid#Of_a_polygon.
 *
 * The points are treated as a single closed ring — the edge from the last point back to the first is
 * implied — and each edge is treated as a straight line. For degenerate polygons with ~zero enclosed
 * area (eg. a single point or a set of collinear points) the average of the vertices is returned
 * instead.
 */
export function centroid<P extends Position>(points: Array<P>): P {
  if (points.length === 0) {
    throw new Error('math.centroid: Cannot compute centroid of an empty array of points!');
  }

  const Constructor = points[0].constructor as new (x: number, y: number) => P;

  let twiceArea = 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const cross = current.x * next.y - next.x * current.y;
    twiceArea += cross;
    sumX += (current.x + next.x) * cross;
    sumY += (current.y + next.y) * cross;
  }

  if (Math.abs(twiceArea) > 1e-9) {
    return new Constructor(sumX / (3 * twiceArea), sumY / (3 * twiceArea));
  }

  // Degenerate (zero-area) polygon - fall back to the average of the vertices.
  const total = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return new Constructor(total.x / points.length, total.y / points.length);
}
