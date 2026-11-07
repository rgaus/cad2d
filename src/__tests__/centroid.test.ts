import { GeometryComponent } from '@/lib/entity';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { type Entity } from '@/lib/entity/types';
import { centroid } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';

function p(x: number, y: number) {
  return new SheetPosition(x, y);
}

function makePolygonGeometry(points: Array<SheetPosition>) {
  return {
    id: 'test',
    components: {
      geometry: {
        type: 'polygon',
        points: points.map((point) => ({ type: 'point' as const, point })),
        closed: true,
        openAtIndex: 0,
      },
    },
  } as unknown as Entity<GeometryComponent<PolygonData>>;
}

describe('math.centroid', () => {
  it('computes the centroid of a square', () => {
    const result = centroid([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(2);
  });

  it('computes the centroid of a triangle', () => {
    const result = centroid([p(0, 0), p(6, 0), p(0, 3)]);
    expect(result.x).toBeCloseTo(2);
    expect(result.y).toBeCloseTo(1);
  });

  it('is area weighted, not just the average of the vertices', () => {
    // An L-shaped hexagon. Its vertex average is (2, 2), but the area centroid is (5/3, 5/3).
    const result = centroid([p(0, 0), p(4, 0), p(4, 2), p(2, 2), p(2, 4), p(0, 4)]);
    expect(result.x).toBeCloseTo(5 / 3);
    expect(result.y).toBeCloseTo(5 / 3);
  });

  it('is unaffected by a duplicated closing point', () => {
    const open = centroid([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
    const closed = centroid([p(0, 0), p(4, 0), p(4, 4), p(0, 4), p(0, 0)]);
    expect(closed.x).toBeCloseTo(open.x);
    expect(closed.y).toBeCloseTo(open.y);
  });

  it('is unaffected by winding order', () => {
    const ccw = centroid([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
    const cw = centroid([p(0, 0), p(0, 4), p(4, 4), p(4, 0)]);
    expect(cw.x).toBeCloseTo(ccw.x);
    expect(cw.y).toBeCloseTo(ccw.y);
  });

  it('falls back to the vertex average for collinear (zero-area) points', () => {
    const result = centroid([p(0, 0), p(2, 0), p(6, 0)]);
    expect(result.x).toBeCloseTo(8 / 3);
    expect(result.y).toBeCloseTo(0);
  });

  it('preserves the position subclass', () => {
    expect(centroid([p(0, 0), p(4, 0), p(4, 4), p(0, 4)])).toBeInstanceOf(SheetPosition);
  });

  it('throws for an empty array', () => {
    expect(() => centroid([])).toThrow();
  });
});

describe('PolygonData.centroid', () => {
  it('matches math.centroid of the polygon vertices', () => {
    const geometry = makePolygonGeometry([p(0, 0), p(4, 0), p(4, 2), p(2, 2), p(2, 4), p(0, 4)]);
    const result = PolygonData.centroid(geometry);
    expect(result.x).toBeCloseTo(5 / 3);
    expect(result.y).toBeCloseTo(5 / 3);
  });

  it('is exposed as a centroid key point', () => {
    const geometry = makePolygonGeometry([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]);
    const keyPoints = PolygonData.keyPoints(geometry);
    expect(keyPoints.extras.centroid.x).toBeCloseTo(2);
    expect(keyPoints.extras.centroid.y).toBeCloseTo(2);
  });
});
