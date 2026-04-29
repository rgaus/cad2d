import EventEmitter from 'eventemitter3';
import { BaseTool } from './BaseTool';
import { ToolManager } from './ToolManager';
import type { ToolType, Id, SheetPosition } from './types';
import { ScreenPosition, ViewportState, LineSegment, QuadraticCurve, CubicCurve } from '../viewport/types';
import { GeometryStore } from './GeometryStore';
import { distance, closestPointOnSegment, closestPointOnQuadraticCurve, closestPointOnCubicCurve, proximityBoundingBox, CohenSutherland, type ClosestPointOnCurveResult } from '../math';

/** Default pixel threshold for detecting intersection points. */
const DEFAULT_PIXEL_THRESHOLD = 10;

/** Data emitted when an intersection point is found. */
export type TrimSplitIntersectionData = {
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
  splitIntersectionPoint: (data: TrimSplitIntersectionData | null) => void;
};

/**
 * TrimSplit tool - allows inserting intersection points into two or more segments.
 * 
 * Algorithm:
 * 1. On mouse move, build a proximity bounding box around the cursor
 * 2. Find all segments that might intersect with this box (via Cohen-Sutherland)
 * 3. For each candidate segment, compute the closest point on the segment to the cursor
 * 4. If the closest point is within the pixel threshold, record the segment as intersecting at that point
 * 5. Group all segments by EXACT same intersection coordinates
 * 6. If group has 2+ segments, emit intersection data
 * 7. On click, split all segments at the intersection point
 */
export class TrimSplitTool extends BaseTool<TrimSplitToolEvents> {
  readonly type: ToolType = 'trim-split';

  /** Current intersection data if found, null otherwise. */
  private currentIntersection: TrimSplitIntersectionData | null = null;

  /** Pixel threshold for detecting intersection points. Converted to sheet units on each move. */
  private pixelThreshold: number = DEFAULT_PIXEL_THRESHOLD;

  constructor(toolManager: ToolManager) {
    super(toolManager);
  }

  getCursor(): string {
    return 'crosshair';
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
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
    const sheetThreshold = this.pixelThreshold / viewport.scale;

    const intersection = this.computeIntersectionAtPoint(sheetPos, sheetThreshold);

    this.currentIntersection = intersection;
    this.emit('splitIntersectionPoint', intersection);
  }

  /** Computes intersection data for a given point.
   * 
   * @param point - The sheet position to check for intersections.
   * @param threshold - The threshold in sheet units for including segments.
   * @returns TrimSplitIntersectionData if 2+ segments intersect at exact same position, null otherwise.
   */
  private computeIntersectionAtPoint(
    point: SheetPosition,
    threshold: number,
  ): TrimSplitIntersectionData | null {
    const geometryStore = this.getGeometryStore();
    const allGeometry = geometryStore.getAllGeometryAsSegments();

    const searchBox = proximityBoundingBox(point, threshold);

    const candidateIntersections: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
      intersectionPoint: SheetPosition;
      distance: number;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;
        let intersectionPoint: SheetPosition | null = null;
        let dist = Infinity;

        if ('controlPointA' in segment && 'controlPointB' in segment) {
          mightIntersect = CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
          if (mightIntersect) {
            const result = closestPointOnCubicCurve(segment, point);
            intersectionPoint = result.point;
            dist = result.distance;
          }
        } else if ('controlPoint' in segment) {
          mightIntersect = CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, searchBox);
          if (mightIntersect) {
            const result = closestPointOnQuadraticCurve(segment, point);
            intersectionPoint = result.point;
            dist = result.distance;
          }
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, searchBox);
          if (mightIntersect) {
            intersectionPoint = closestPointOnSegment(segment.start, segment.end, point);
            const dx = intersectionPoint.x - point.x;
            const dy = intersectionPoint.y - point.y;
            dist = Math.sqrt(dx * dx + dy * dy);
          }
        }

        if (mightIntersect && intersectionPoint && dist <= threshold) {
          candidateIntersections.push({
            shapeId: shape.id,
            shapeType: shape.type,
            segmentIndex: index,
            segment,
            intersectionPoint,
            distance: dist,
          });
        }
      }
    }

    if (candidateIntersections.length === 0) {
      return null;
    }

    const candidatesSorted = candidateIntersections.sort((a, b) => a.distance - b.distance);
    const closestCandidate = candidatesSorted[0];
    const closestPoint = closestCandidate.intersectionPoint;

    const exactMatches = candidatesSorted.filter((c) => {
      const dx = c.intersectionPoint.x - closestPoint.x;
      const dy = c.intersectionPoint.y - closestPoint.y;
      return Math.abs(dx) < 1e-10 && Math.abs(dy) < 1e-10;
    });

    if (exactMatches.length < 2) {
      return null;
    }

    const targets = exactMatches.map((c) => {
      let splitRatio = 0;

      if ('controlPoint' in c.segment) {
        const result = closestPointOnQuadraticCurve(c.segment, c.intersectionPoint);
        splitRatio = result.t;
      } else if ('controlPointA' in c.segment && 'controlPointB' in c.segment) {
        const result = closestPointOnCubicCurve(c.segment, c.intersectionPoint);
        splitRatio = result.t;
      } else {
        const dx = c.segment.end.x - c.segment.start.x;
        const dy = c.segment.end.y - c.segment.start.y;
        if (dx !== 0 || dy !== 0) {
          const t = ((c.intersectionPoint.x - c.segment.start.x) * dx + (c.intersectionPoint.y - c.segment.start.y) * (dx * dx + dy * dy)) / (dx * dx + dy * dy);
          splitRatio = t;
        }
      }

      return {
        id: c.shapeId,
        type: c.shapeType,
        segmentIndex: c.segmentIndex,
        splitRatio,
      };
    });

    return {
      point: closestPoint,
      targets,
    };
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