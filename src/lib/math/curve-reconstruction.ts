import { type PolygonSegment } from '@/lib/geometry';
import { DeCasteljau } from '@/lib/math/bezier';
import { type CubicCurve, type QuadraticCurve, SheetPosition } from '@/lib/viewport/types';
import {
  arcToLineSegments,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  distance,
} from './index';

/**
 * Default number of samples for curve rasterization.
 * Must match the value used in extractPointsFromSegments.
 */
const NUM_SAMPLES = 20;

/**
 * Tolerance for matching result points to original curve.
 * Sheet units. Set large enough to accommodate polyclip-ts floating-point
 * adjustments but small enough to avoid false matches.
 */
const MATCH_TOLERANCE = 0.01;

/**
 * Collected information about an original segment from a shape.
 * Used by the curve reconstruction algorithm to match result points
 * back to original curves.
 */
export type OriginalSegmentInfo = {
  type: 'point' | 'arc-quadratic' | 'arc-cubic';
  /** The endpoint of this segment. */
  point: SheetPosition;
  /** The start point of this segment (previous segment's endpoint). */
  prevPoint: SheetPosition;
  /** For quadratic curves: the control point. */
  controlPoint?: SheetPosition;
  /** For cubic curves: the two control points. */
  controlPointA?: SheetPosition;
  controlPointB?: SheetPosition;
  /** Precomputed sampled points from arcToLineSegments (only for non-point segments). */
  sampledPoints: Array<SheetPosition>;
};

/**
 * Collect original segment info from a polygon's segments.
 * This captures the curve metadata before rasterization, enabling
 * curve reconstruction after the boolean operation.
 */
export function collectOriginalSegments(
  segments: Array<PolygonSegment>,
): Array<OriginalSegmentInfo> {
  const result: Array<OriginalSegmentInfo> = [];
  let prevPoint: SheetPosition | null = null;

  for (const seg of segments) {
    if (prevPoint !== null) {
      if (seg.type === 'arc-quadratic') {
        const curve: QuadraticCurve<SheetPosition> = {
          start: prevPoint,
          end: seg.point,
          controlPoint: seg.controlPoint,
        };
        const sampled = arcToLineSegments(curve, NUM_SAMPLES);
        result.push({
          type: 'arc-quadratic',
          point: seg.point,
          prevPoint,
          controlPoint: seg.controlPoint,
          sampledPoints: sampled,
        });
      } else if (seg.type === 'arc-cubic') {
        const curve: CubicCurve<SheetPosition> = {
          start: prevPoint,
          end: seg.point,
          controlPointA: seg.controlPointA,
          controlPointB: seg.controlPointB,
        };
        const sampled = arcToLineSegments(curve, NUM_SAMPLES);
        result.push({
          type: 'arc-cubic',
          point: seg.point,
          prevPoint,
          controlPointA: seg.controlPointA,
          controlPointB: seg.controlPointB,
          sampledPoints: sampled,
        });
      } else {
        const sampled = [prevPoint, seg.point];
        result.push({
          type: 'point',
          point: seg.point,
          prevPoint,
          sampledPoints: sampled,
        });
      }
    }
    prevPoint = seg.point;
  }

  return result;
}

/**
 * Extract a sub-curve from an original curve segment using De Casteljau subdivision.
 * Returns a PolygonSegment covering the interval [tStart, tEnd] on the original curve.
 */
function reconstructSubCurve(
  info: OriginalSegmentInfo,
  tStart: number,
  tEnd: number,
): PolygonSegment {
  if (info.type === 'arc-quadratic') {
    const curve: QuadraticCurve<SheetPosition> = {
      start: info.prevPoint,
      controlPoint: info.controlPoint!,
      end: info.point,
    };
    const clampedTEnd = Math.min(tEnd, 1);
    const [leftAtEnd] = DeCasteljau.splitQuadraticBezier(curve, clampedTEnd);
    const splitRatio = clampedTEnd > 0 ? Math.max(0, Math.min(1, tStart / clampedTEnd)) : 0;
    const [, subCurve] = DeCasteljau.splitQuadraticBezier(leftAtEnd, splitRatio);
    return {
      type: 'arc-quadratic',
      point: subCurve.end,
      controlPoint: subCurve.controlPoint,
    };
  }

  if (info.type === 'arc-cubic') {
    const curve: CubicCurve<SheetPosition> = {
      start: info.prevPoint,
      controlPointA: info.controlPointA!,
      controlPointB: info.controlPointB!,
      end: info.point,
    };
    const clampedTEnd = Math.min(tEnd, 1);
    const [leftAtEnd] = DeCasteljau.splitCubicBezier(curve, clampedTEnd);
    const splitRatio = clampedTEnd > 0 ? Math.max(0, Math.min(1, tStart / clampedTEnd)) : 0;
    const [, subCurve] = DeCasteljau.splitCubicBezier(leftAtEnd, splitRatio);
    return {
      type: 'arc-cubic',
      point: subCurve.end,
      controlPointA: subCurve.controlPointA,
      controlPointB: subCurve.controlPointB,
    };
  }

  return { type: 'point', point: info.point };
}

type PointClassification = {
  info: OriginalSegmentInfo | null;
  t: number;
};

/**
 * Classify each result point by finding the closest original curve and its
 * parameter t. Uses closest-point-on-curve computation for robust matching
 * even when polyclip-ts introduces floating-point adjustments.
 */
function classifyPoints(
  resultPoints: Array<SheetPosition>,
  originalInfos: Array<OriginalSegmentInfo>,
): Array<PointClassification> {
  const classifications: Array<PointClassification> = [];

  for (const pt of resultPoints) {
    let bestInfo: OriginalSegmentInfo | null = null;
    let bestT = 0;
    let bestDist = Infinity;

    for (const info of originalInfos) {
      if (info.type === 'point') {
        continue;
      }

      if (info.type === 'arc-quadratic') {
        const curve: QuadraticCurve<SheetPosition> = {
          start: info.prevPoint,
          controlPoint: info.controlPoint!,
          end: info.point,
        };
        const result = closestPointOnQuadraticCurve(curve, pt);
        // Bias toward interior points (not exact endpoints) to prefer
        // the correct curve when a vertex belongs to two adjacent curves.
        if (result.distance < bestDist - 1e-10) {
          bestDist = result.distance;
          bestInfo = info;
          bestT = result.t;
        }
      } else if (info.type === 'arc-cubic') {
        const curve: CubicCurve<SheetPosition> = {
          start: info.prevPoint,
          controlPointA: info.controlPointA!,
          controlPointB: info.controlPointB!,
          end: info.point,
        };
        const result = closestPointOnCubicCurve(curve, pt);
        if (result.distance < bestDist - 1e-10) {
          bestDist = result.distance;
          bestInfo = info;
          bestT = result.t;
        }
      }
    }

    if (bestInfo && bestDist < MATCH_TOLERANCE) {
      classifications.push({ info: bestInfo, t: bestT });
    } else {
      classifications.push({ info: null, t: 0 });
    }
  }

  return classifications;
}

/**
 * Process result points from polyclip-ts and reconstruct curve segments
 * where they match original input curves.
 *
 * Uses closest-point-on-curve matching to robustly identify which original
 * curve each result point lies on, even when polyclip-ts introduces small
 * floating-point adjustments. Consecutive result points on the same original
 * curve are grouped and reconstructed as a single sub-curve segment.
 * Non-matching edges fall back to point segments.
 */
export function reconstructResultSegments(
  resultPoints: Array<SheetPosition>,
  originalInfos: Array<OriginalSegmentInfo>,
): Array<PolygonSegment> {
  if (resultPoints.length < 2) {
    return resultPoints.map((p) => ({ type: 'point' as const, point: p }));
  }

  const classes = classifyPoints(resultPoints, originalInfos);
  const segs: Array<PolygonSegment> = [];

  // The first result point is always the start vertex (point segment)
  segs.push({ type: 'point', point: resultPoints[0] });

  let i = 0;
  while (i < resultPoints.length - 1) {
    const curClass = classes[i];
    const nextClass = classes[i + 1];

    if (curClass.info !== null && nextClass.info !== null && curClass.info === nextClass.info) {
      // Found a run of consecutive points on the same curve.
      // Extend the run as far as possible, but do not include the closing
      // point (last = first) since it wraps the t range back to zero.
      const curveInfo = curClass.info;
      let j = i + 2;
      while (j < resultPoints.length - 1 && classes[j].info === curveInfo) {
        j += 1;
      }
      // Run: points i ... j-1 (inclusive) all on the same curve.
      // That's (j-1 - i) edges = j - i - 1 edges.
      const tStart = classes[i].t;
      const tEnd = classes[j - 1].t;

      // Reconstruct only if the parametric range is meaningful and the
      // parametric direction matches the polygon traversal direction.
      // When tEnd < tStart the closing edge wraps around (t=1 back to t=0)
      // and should not be reconstructed as a full curve.
      if (Math.abs(tEnd - tStart) > 0.001 && tEnd >= tStart) {
        const segment = reconstructSubCurve(curveInfo, tStart, tEnd);
        segs.push(segment);
        i = j - 1;
      } else {
        // Fall back: emit point segments for the entire run
        const fallbackEnd = Math.min(j - 1, resultPoints.length - 1);
        for (let k = i; k < fallbackEnd; k += 1) {
          segs.push({ type: 'point', point: resultPoints[k + 1] });
        }
        i = fallbackEnd;
      }
    } else {
      segs.push({ type: 'point', point: resultPoints[i + 1] });
      i += 1;
    }
  }

  return segs;
}
