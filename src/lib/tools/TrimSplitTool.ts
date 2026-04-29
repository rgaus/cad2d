import { BaseTool } from './BaseTool';
import { ToolManager } from './ToolManager';
import type { ToolType, Id, SheetPosition } from './types';
import { ScreenPosition, ViewportState, LineSegment, QuadraticCurve, CubicCurve } from '../viewport/types';
import { proximityBoundingBox, CohenSutherland, distance } from '../math';
import { Intersection } from '../math/intersection';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';

/** Default pixel threshold for detecting intersection points. */
const DEFAULT_PIXEL_THRESHOLD = 10;

/** Data emitted when an intersection point is found. */
export type SplitIntersectionData = {
  /** The exact sheet position where segments intersect. */
  point: SheetPosition;
  /** List of all shapes and their segments that intersect at this point. */
  targets: Array<{
    /** The id of the shape. */
    id: Id;
    /** The type of the shape. */
    type: 'polygon' | 'rectangle' | 'ellipse';
    /** The index of the segment in the shape's points array. */
    segmentIndex: number;
    /** The split ratio (t parameter) for curve splitting. */
    splitRatio: number;
  }>;
};

/** Events emitted by the TrimSplit tool. */
export type TrimSplitToolEvents = {
  /** Emitted when the mouse moves and finds an intersection point with 2+ segments at exact same position,
   * or null if no valid intersection exists within the threshold. */
  splitIntersectionPoint: (data: SplitIntersectionData | null) => void;
};

/**
 * TrimSplit tool - allows inserting intersection points into two or more segments.
 *
 * Algorithm:
 * 1. On mouse move, build a proximity bounding box around the cursor
 * 2. Filter candidate segments using Cohen-Sutherland (line/quad/cubic vs bounding box)
 * 3. Compute all pairwise intersections between candidate segments
 * 4. Group all intersections by exact coordinate
 * 5. Find closest group to mouse cursor
 * 6. Emit intersection data if group has 2+ segments
 * 7. On click, split all segments at the intersection point
 */
export class TrimSplitTool extends BaseTool<TrimSplitToolEvents> {
  readonly type = 'trim-split' as const;

  /** Current intersection data if found, null otherwise. */
  private currentIntersection: SplitIntersectionData | null = null;

  /** Pixel threshold for detecting intersection points. Converted to sheet units on each move. */
  private pixelThreshold: number = DEFAULT_PIXEL_THRESHOLD;

  constructor(toolManager: ToolManager) {
    super(toolManager);
  }

  getCursor(): string {
    return 'default';
  }

  handleMouseDown(): void {
    if (!this.currentIntersection) {
      return;
    }

    const geometryStore = this.getGeometryStore();
    const targets = this.currentIntersection.targets;

    let indexOffset = 0;

    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      let shapeId = target.id;
      let targetType = target.type;

      if (targetType === 'rectangle') {
        const polygon = geometryStore.convertRectangleToPolygon(shapeId);
        shapeId = polygon.id;
        targetType = 'polygon';
      } else if (targetType === 'ellipse') {
        const polygon = geometryStore.convertEllipseToPolygon(shapeId);
        shapeId = polygon.id;
        targetType = 'polygon';
      }

      const adjustedSegmentIndex = target.segmentIndex + indexOffset;
      const newPoint = this.currentIntersection.point;
      const polygon = geometryStore.getPolygonById(shapeId);

      if (!polygon) {
        continue;
      }

      const segment = polygon.points[adjustedSegmentIndex];

      if (!segment) {
        continue;
      }

      if (segment.type === 'point') {
        const nextSegment = polygon.points[adjustedSegmentIndex + 1];
        if (nextSegment && nextSegment.type === 'point') {
          geometryStore.addPointOnLineSegmentEdge(shapeId, adjustedSegmentIndex, newPoint);
        }
      } else if (segment.type === 'arc-quadratic') {
        const prevPointSegment = polygon.points[adjustedSegmentIndex];
        if (prevPointSegment && prevPointSegment.type === 'point') {
          geometryStore.addPointOnQuadraticEdge(shapeId, adjustedSegmentIndex, target.splitRatio, newPoint);
        }
      } else if (segment.type === 'arc-cubic') {
        const prevPointSegment = polygon.points[adjustedSegmentIndex];
        if (prevPointSegment && prevPointSegment.type === 'point') {
          geometryStore.addPointOnCubicEdge(shapeId, adjustedSegmentIndex, target.splitRatio, newPoint);
        }
      }

      indexOffset += 1;
    }

    this.currentIntersection = null;
    this.emit('splitIntersectionPoint', null);
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const sheetPos = screenPos.toWorld(viewport).toSheet();
    const sheetThreshold = DEFAULT_PIXEL_THRESHOLD / SHEET_UNITS_TO_PIXELS / viewport.scale;

    const intersection = this.computeIntersectionAtPoint(sheetPos, sheetThreshold);

    this.currentIntersection = intersection;
    this.emit('splitIntersectionPoint', intersection);
  }

  /** Computes intersection data for a given point using the new algorithm.
   *
   * @param point - The sheet position of the mouse cursor.
   * @param threshold - The threshold in sheet units for including segments.
   * @returns SplitIntersectionData if 2+ segments intersect at exact same position, null otherwise.
   */
  private computeIntersectionAtPoint(
    mousePos: SheetPosition,
    threshold: number,
  ): SplitIntersectionData | null {
    const geometryStore = this.getGeometryStore();
    const allGeometry = geometryStore.getAllGeometryAsSegments();

    const searchBox = proximityBoundingBox(mousePos, threshold);

    // Step 1: Filter candidate segments using Cohen-Sutherland
    const candidates: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if ('controlPointA' in segment && 'controlPointB' in segment) {
          mightIntersect = CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
        } else if ('controlPoint' in segment) {
          mightIntersect = CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, searchBox);
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, searchBox);
        }

        if (mightIntersect) {
          candidates.push({
            shapeId: shape.id,
            shapeType: shape.type,
            segmentIndex: index,
            segment,
          });
        }
      }
    }

    if (candidates.length < 2) {
      return null;
    }

    // Step 2: Compute all pairwise intersections
    const intersections: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
      point: SheetPosition;
      t1: number;
      t2?: number;
    }> = [];

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const segA = candidates[i];
        const segB = candidates[j];

        const segAIntersections = this.computeSegmentPairIntersections(
          segA.segment,
          segB.segment,
        );

        for (const [point, tA, tB] of segAIntersections) {
          // Don't log intersection if it's at the end of a segment, as there already is a point
          // there.
          if (tA === 0 || tA === 1 || tB === 0 || tA === 1)  {
            continue;
          }

          intersections.push({
            shapeId: segA.shapeId,
            shapeType: segA.shapeType,
            segmentIndex: segA.segmentIndex,
            segment: segA.segment,
            point,
            t1: tA,
            t2: tB,
          });
          intersections.push({
            shapeId: segB.shapeId,
            shapeType: segB.shapeType,
            segmentIndex: segB.segmentIndex,
            segment: segB.segment,
            point,
            t1: tB,
            t2: tA,
          });
        }
      }
    }

    if (intersections.length === 0) {
      return null;
    }

    // Step 3: Group intersections by exact coordinate
    const pointGroups = new Map<string, Array<typeof intersections[0]>>();

    for (const inters of intersections) {
      const key = `${inters.point.x.toFixed(10)},${inters.point.y.toFixed(10)}`;
      let group = pointGroups.get(key);
      if (!group) {
        group = [];
        pointGroups.set(key, group);
      }
      group.push(inters);
    }

    // Step 4: Find closest group to mouse cursor
    let closestGroup: Array<typeof intersections[0]> | null = null;
    let closestGroupDist = Infinity;

    for (const group of pointGroups.values()) {
      if (group.length < 2) {
        continue;
      }

      const dist = distance(group[0].point, mousePos);
      if (dist < closestGroupDist) {
        closestGroupDist = dist;
        closestGroup = group;
      }
    }

    if (!closestGroup || closestGroup.length < 2) {
      return null;
    }

    if (closestGroupDist > threshold) {
      return null;
    }

    // Step 5: Build targets from the closest group
    const targets = closestGroup.map((c) => ({
      id: c.shapeId,
      type: c.shapeType,
      segmentIndex: c.segmentIndex,
      splitRatio: c.t1,
    }));

    return {
      point: closestGroup[0].point,
      targets,
    };
  }

  /** Computes all intersections between a pair of segments.
   *
   * @param segA - First segment.
   * @param segB - Second segment.
   * @returns Array of [intersectionPoint, tOnSegA, tOnSegB].
   */
  private computeSegmentPairIntersections(
    segA: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
    segB: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
  ): Array<[SheetPosition, number, number]> {
    const results: Array<[SheetPosition, number, number]> = [];

    const isLineA = !('controlPoint' in segA);
    const isLineB = !('controlPoint' in segB);
    const isQuadA = 'controlPoint' in segA && !('controlPointA' in segA);
    const isQuadB = 'controlPoint' in segB && !('controlPointB' in segB);
    const isCubicA = 'controlPointA' in segA && 'controlPointB' in segA;
    const isCubicB = 'controlPointB' in segB && 'controlPointB' in segB;

    if (isLineA && isLineB) {
      const result = Intersection.computeLineSegmentIntersection(segA, segB);
      if (result) {
        results.push([result[0], result[1], result[1]]);
      }
    } else if (isLineA && isQuadB) {
      const resultsB = Intersection.computeLineSegmentQuadraticCurveIntersections(segA, segB);
      for (const [point, t] of resultsB) {
        results.push([point, t, t]);
      }
    } else if (isLineA && isCubicB) {
      const resultsB = Intersection.computeLineSegmentCubicCurveIntersections(segA, segB);
      for (const [point, t] of resultsB) {
        results.push([point, t, t]);
      }
    } else if (isQuadA && isLineB) {
      const resultsA = Intersection.computeLineSegmentQuadraticCurveIntersections(segB, segA);
      for (const [point, t] of resultsA) {
        results.push([point, t, t]);
      }
    } else if (isQuadA && isQuadB) {
      const resultsAB = Intersection.computeQuadraticQuadraticCurveIntersections(segA as QuadraticCurve<SheetPosition>, segB as QuadraticCurve<SheetPosition>);
      for (const [point, t, u] of resultsAB) {
        results.push([point, t, u]);
      }
    } else if (isQuadA && isCubicB) {
      const resultsAB = Intersection.computeQuadraticCubicCurveIntersections(segA as QuadraticCurve<SheetPosition>, segB as CubicCurve<SheetPosition>);
      for (const [point, t, u] of resultsAB) {
        results.push([point, t, u]);
      }
    } else if (isCubicA && isLineB) {
      const resultsA = Intersection.computeLineSegmentCubicCurveIntersections(segB, segA);
      for (const [point, t] of resultsA) {
        results.push([point, t, t]);
      }
    } else if (isCubicA && isQuadB) {
      const resultsBA = Intersection.computeQuadraticCubicCurveIntersections(segB as QuadraticCurve<SheetPosition>, segA as CubicCurve<SheetPosition>);
      for (const [point, u, t] of resultsBA) {
        results.push([point, t, u]);
      }
    } else if (isCubicA && isCubicB) {
      const resultsAB = Intersection.computeCubicCubicCurveIntersections(segA as CubicCurve<SheetPosition>, segB as CubicCurve<SheetPosition>);
      for (const [point, t, u] of resultsAB) {
        results.push([point, t, u]);
      }
    }

    return results;
  }

  /** Sets the pixel threshold for detection.
   *
   * @param pixels - Threshold in screen pixels.
   */
  setPixelThreshold(pixels: number): void {
    this.pixelThreshold = pixels;
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentIntersection = null;
    this.pixelThreshold = DEFAULT_PIXEL_THRESHOLD;
  }
}
