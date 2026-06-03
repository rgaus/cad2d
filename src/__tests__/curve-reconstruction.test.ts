import { type PolygonSegment } from '@/lib/geometry';
import {
  collectOriginalSegments,
  reconstructResultSegments,
} from '@/lib/math/curve-reconstruction';
import { SheetPosition } from '@/lib/viewport/types';

describe('collectOriginalSegments', () => {
  it('collects point segments as point type', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      { type: 'point', point: new SheetPosition(10, 0) },
      { type: 'point', point: new SheetPosition(10, 10) },
      { type: 'point', point: new SheetPosition(0, 10) },
      { type: 'point', point: new SheetPosition(0, 0) },
    ];

    const infos = collectOriginalSegments(segs);
    expect(infos).toHaveLength(4); // 4 edges (first seg has no prevPoint)
    for (const info of infos) {
      expect(info.type).toBe('point');
    }
  });

  it('collects cubic arc segment with sampled points', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      {
        type: 'arc-cubic',
        point: new SheetPosition(10, 0),
        controlPointA: new SheetPosition(5, -5),
        controlPointB: new SheetPosition(5, 5),
      },
    ];

    const infos = collectOriginalSegments(segs);
    expect(infos).toHaveLength(1);
    expect(infos[0].type).toBe('arc-cubic');
    expect(infos[0].sampledPoints.length).toBe(21); // 20 samples + end
    expect(infos[0].point.x).toBeCloseTo(10);
    expect(infos[0].point.y).toBeCloseTo(0);
    expect(infos[0].prevPoint.x).toBeCloseTo(0);
    expect(infos[0].prevPoint.y).toBeCloseTo(0);
    expect(infos[0].controlPointA?.x).toBeCloseTo(5);
    expect(infos[0].controlPointB?.x).toBeCloseTo(5);
  });

  it('collects quadratic arc segment with sampled points', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      {
        type: 'arc-quadratic',
        point: new SheetPosition(10, 0),
        controlPoint: new SheetPosition(5, 10),
      },
    ];

    const infos = collectOriginalSegments(segs);
    expect(infos).toHaveLength(1);
    expect(infos[0].type).toBe('arc-quadratic');
    expect(infos[0].sampledPoints.length).toBe(21);
    expect(infos[0].controlPoint?.x).toBeCloseTo(5);
    expect(infos[0].controlPoint?.y).toBeCloseTo(10);
  });

  it('handles no previous point correctly (first segment skipped)', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(5, 5) },
      { type: 'point', point: new SheetPosition(10, 5) },
    ];

    const infos = collectOriginalSegments(segs);
    expect(infos).toHaveLength(1); // only the second seg produces an edge
    expect(infos[0].prevPoint.x).toBeCloseTo(5);
    expect(infos[0].prevPoint.y).toBeCloseTo(5);
    expect(infos[0].point.x).toBeCloseTo(10);
    expect(infos[0].point.y).toBeCloseTo(5);
  });
});

describe('reconstructResultSegments', () => {
  it('returns point segments when no curve matches', () => {
    const resultPoints = [
      new SheetPosition(0, 0),
      new SheetPosition(10, 0),
      new SheetPosition(10, 10),
      new SheetPosition(0, 0),
    ];

    const segs = reconstructResultSegments(resultPoints, []);
    expect(segs).toHaveLength(4);
    for (const seg of segs) {
      expect(seg.type).toBe('point');
    }
  });

  it('reconstructs cubic curve segment from full sampled points', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      {
        type: 'arc-cubic',
        point: new SheetPosition(10, 0),
        controlPointA: new SheetPosition(3, -5),
        controlPointB: new SheetPosition(7, 5),
      },
    ];
    const infos = collectOriginalSegments(segs);

    const sampledPoints = infos[0].sampledPoints;
    const resultPoints = [...sampledPoints, sampledPoints[0]];

    const resultSegs = reconstructResultSegments(resultPoints, infos);

    // Start point + reconstructed curve + closing point
    expect(resultSegs.length).toBe(3);

    const cubicSegs = resultSegs.filter((s) => s.type === 'arc-cubic');
    expect(cubicSegs.length).toBe(1);

    const cubic = cubicSegs[0];
    if (cubic.type === 'arc-cubic') {
      expect(cubic.controlPointA.x).toBeGreaterThan(0);
      expect(cubic.controlPointA.y).toBeLessThan(0);
      expect(cubic.controlPointB.x).toBeGreaterThan(0);
      expect(cubic.controlPointB.y).toBeGreaterThan(0);
    }
  });

  it('reconstructs quadratic curve segment from full sampled points', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      {
        type: 'arc-quadratic',
        point: new SheetPosition(10, 0),
        controlPoint: new SheetPosition(5, 8),
      },
    ];
    const infos = collectOriginalSegments(segs);

    const sampledPoints = infos[0].sampledPoints;
    const resultPoints = [...sampledPoints, sampledPoints[0]];

    const resultSegs = reconstructResultSegments(resultPoints, infos);

    const quadSegs = resultSegs.filter((s) => s.type === 'arc-quadratic');
    expect(quadSegs.length).toBe(1);

    const quad = quadSegs[0];
    if (quad.type === 'arc-quadratic') {
      expect(quad.controlPoint.y).toBeGreaterThan(0);
    }
  });

  it('reconstructs sub-curve from partial match (curve was clipped)', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      {
        type: 'arc-quadratic',
        point: new SheetPosition(10, 0),
        controlPoint: new SheetPosition(5, 10),
      },
    ];
    const infos = collectOriginalSegments(segs);

    const sampledPoints = infos[0].sampledPoints;
    // Only a consecutive middle portion matches (indexes 5-15, inclusive)
    // 11 points = 10 consecutive edges
    const resultPoints = sampledPoints.slice(5, 16);
    resultPoints.push(resultPoints[0]);

    const resultSegs = reconstructResultSegments(resultPoints, infos);

    const quadSegs = resultSegs.filter((s) => s.type === 'arc-quadratic');
    expect(quadSegs.length).toBe(1);

    if (quadSegs.length > 0 && quadSegs[0].type === 'arc-quadratic') {
      const subCurve = quadSegs[0];
      expect(subCurve.controlPoint.y).toBeGreaterThan(0);
      // The sub-curve control point should differ from the full curve's CP
      expect(subCurve.controlPoint.y).not.toBeCloseTo(10, 0);
    }
  });

  it('falls back to point segments for unmatched result edges', () => {
    const segs: Array<PolygonSegment> = [
      { type: 'point', point: new SheetPosition(0, 0) },
      { type: 'point', point: new SheetPosition(10, 0) },
    ];
    const infos = collectOriginalSegments(segs);

    const resultPoints = [
      new SheetPosition(100, 100),
      new SheetPosition(200, 100),
      new SheetPosition(200, 200),
      new SheetPosition(100, 200),
      new SheetPosition(100, 100),
    ];

    const resultSegs = reconstructResultSegments(resultPoints, infos);

    for (const seg of resultSegs) {
      expect(seg.type).toBe('point');
    }
    expect(resultSegs).toHaveLength(5);
  });

  it('handles empty result points gracefully', () => {
    const segs: Array<PolygonSegment> = [{ type: 'point', point: new SheetPosition(0, 0) }];
    const infos = collectOriginalSegments(segs);

    const resultSegs = reconstructResultSegments([], infos);
    expect(resultSegs).toHaveLength(0);

    const resultSegs2 = reconstructResultSegments([new SheetPosition(5, 5)], infos);
    expect(resultSegs2).toHaveLength(1);
    expect(resultSegs2[0].type).toBe('point');
  });
});
