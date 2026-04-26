import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { Id, type Polygon, type PolygonSegment, type PointSegment, type QuadraticBezierSegment, type CubicBezierSegment } from './types';
import { distance, computeLineSegmentIntersection, closestPointOnSegment } from '../math';

export type TrimMode = 'split' | 'delete';

export type TrimSplitToolEvents = {
  modeChange: (mode: TrimMode) => void;
  hoveredSegmentChange: (segment: HoveredSegment | null) => void;
  previewIntersectionsChange: (intersections: Array<IntersectionPreview>) => void;
};

export type HoveredSegment = {
  shapeId: Id;
  shapeType: 'polygon' | 'rectangle' | 'ellipse';
  segmentIndex: number;
  /** The point on the segment closest to the mouse */
  closestPoint: SheetPosition;
  /** Parameter t along the segment (0-1) for point segments */
  t?: number;
};

export type IntersectionPreview = {
  point: SheetPosition;
  willCreateOn: { id: Id; segmentIndex: number };
};

const HOVER_DISTANCE_THRESHOLD = 20;
const INTERSECTION_TOLERANCE = 0.01;

export class TrimSplitTool extends BaseTool<TrimSplitToolEvents> {
  type = 'trim-split' as const;

  mode: TrimMode = 'delete';

  hoveredSegment: HoveredSegment | null = null;
  previewIntersections: Array<IntersectionPreview> = [];

  handleToolBlur(): void {
    console.log('[TrimSplit] Tool blur - clearing hover state');
    this.clearHoverState();
  }

  getCursor(): string {
    return 'pointer';
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    console.log('[TrimSplit] Mouse move at sheet:', sheetPos.x, sheetPos.y);

    const closestSegment = this.findClosestSegment(sheetPos, viewport);

    if (closestSegment !== this.hoveredSegment) {
      console.log('[TrimSplit] Hover changed:', closestSegment ? 
        `{shapeId: ${closestSegment.shapeId}, segmentIndex: ${closestSegment.segmentIndex}, closestPoint: (${closestSegment.closestPoint.x}, ${closestSegment.closestPoint.y})}` : 
        'null');
      this.hoveredSegment = closestSegment;
      this.emit('hoveredSegmentChange', closestSegment);

      if (closestSegment) {
        this.computePreviewIntersections(closestSegment, sheetPos);
      } else {
        this.previewIntersections = [];
        this.emit('previewIntersectionsChange', []);
      }
    }
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (!this.hoveredSegment) {
      console.log('[TrimSplit] Mouse down but no hovered segment');
      return;
    }

    console.log('[TrimSplit] Mouse down - mode:', this.mode);
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    console.log('[TrimSplit] Click at sheet:', sheetPos.x, sheetPos.y);

    this.performTrimOrSplit(this.hoveredSegment, sheetPos);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'x' || event.key === 'X') {
      const newMode = this.mode === 'split' ? 'delete' : 'split';
      console.log('[TrimSplit] Toggle mode:', this.mode, '->', newMode);
      this.mode = newMode;
      this.emit('modeChange', newMode);

      if (this.hoveredSegment) {
        this.computePreviewIntersections(this.hoveredSegment, this.hoveredSegment.closestPoint);
      }
    } else if (event.key === 'Escape') {
      console.log('[TrimSplit] Escape - clearing hover state');
      this.clearHoverState();
    }
  }

  private clearHoverState(): void {
    this.hoveredSegment = null;
    this.previewIntersections = [];
    this.emit('hoveredSegmentChange', null);
    this.emit('previewIntersectionsChange', []);
  }

  private findClosestSegment(sheetPos: SheetPosition, viewport: ViewportState): HoveredSegment | null {
    let closest: HoveredSegment | null = null;
    let minDist = HOVER_DISTANCE_THRESHOLD * HOVER_DISTANCE_THRESHOLD;

    for (const polygon of this.getGeometryStore().polygons) {
      console.log('[TrimSplit] Checking polygon:', polygon.id, 'with', polygon.points.length, 'points');
      for (let i = 0; i < polygon.points.length - 1; i++) {
        const seg = polygon.points[i];
        const nextSeg = polygon.points[i + 1];

        const result = this.distanceToSegmentDetailed(seg, nextSeg, sheetPos);

        if (result.dist < minDist) {
          minDist = result.dist;
          closest = {
            shapeId: polygon.id,
            shapeType: 'polygon',
            segmentIndex: i,
            closestPoint: result.closestPoint,
            t: result.t,
          };
          console.log('[TrimSplit]   Segment', i, 'closer:', result.dist, 'at', result.closestPoint.x, result.closestPoint.y);
        }
      }
    }

    for (const rectangle of this.getGeometryStore().rectangles) {
      const edges = this.getRectangleEdges(rectangle);
      for (let i = 0; i < edges.length; i++) {
        const { start, end } = edges[i];
        const dist = this.distanceToLineSegment(start, end, sheetPos);

        if (dist < minDist) {
          minDist = dist;
          const closestPt = closestPointOnSegment(start, end, sheetPos);
          closest = {
            shapeId: rectangle.id,
            shapeType: 'rectangle',
            segmentIndex: i,
            closestPoint: closestPt,
          };
        }
      }
    }

    for (const ellipse of this.getGeometryStore().ellipses) {
      const dist = this.distanceToEllipse(ellipse, sheetPos);

      if (dist < minDist) {
        minDist = dist;
        closest = {
          shapeId: ellipse.id,
          shapeType: 'ellipse',
          segmentIndex: 0,
          closestPoint: sheetPos,
        };
      }
    }

    return closest;
  }

  private distanceToSegmentDetailed(
    seg: PolygonSegment,
    nextSeg: PolygonSegment,
    point: SheetPosition
  ): { dist: number; closestPoint: SheetPosition; t?: number } {
    if (seg.type === 'point' && nextSeg.type === 'point') {
      const closest = closestPointOnSegment(seg.point, nextSeg.point, point);
      return {
        dist: distance(closest, point),
        closestPoint: closest,
        t: this.computeT(seg.point, nextSeg.point, closest),
      };
    }

    if (seg.type === 'arc-quadratic' && nextSeg.type === 'point') {
      return {
        dist: this.distanceToQuadraticBezier(seg.point, seg.controlPoint, nextSeg.point, point),
        closestPoint: this.closestPointOnQuadraticBezier(seg.point, seg.controlPoint, nextSeg.point, point),
      };
    }

    if (seg.type === 'arc-cubic' && nextSeg.type === 'point') {
      return {
        dist: this.distanceToCubicBezier(seg.point, seg.controlPointA, seg.controlPointB, nextSeg.point, point),
        closestPoint: this.closestPointOnCubicBezier(seg.point, seg.controlPointA, seg.controlPointB, nextSeg.point, point),
      };
    }

    return { dist: Infinity, closestPoint: point };
  }

  private computeT(start: SheetPosition, end: SheetPosition, point: SheetPosition): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return 0;
    return ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  }

  private distanceToLineSegment(start: SheetPosition, end: SheetPosition, point: SheetPosition): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    if (dx === 0 && dy === 0) {
      return distance(start, point);
    }

    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
    const clampedT = Math.max(0, Math.min(1, t));

    const closest = new SheetPosition(
      start.x + clampedT * dx,
      start.y + clampedT * dy,
    );

    return distance(closest, point);
  }

  private closestPointOnQuadraticBezier(start: SheetPosition, control: SheetPosition, end: SheetPosition, point: SheetPosition): SheetPosition {
    let minDist = Infinity;
    let bestT = 0;
    let bestPoint = start;

    for (let t = 0; t <= 1; t += 0.01) {
      const u = 1 - t;
      const testPoint = new SheetPosition(
        u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        u * u * start.y + 2 * u * t * control.y + t * t * end.y,
      );
      const dist = distance(testPoint, point);
      if (dist < minDist) {
        minDist = dist;
        bestT = t;
        bestPoint = testPoint;
      }
    }

    return bestPoint;
  }

  private distanceToQuadraticBezier(
    start: SheetPosition,
    control: SheetPosition,
    end: SheetPosition,
    point: SheetPosition
  ): number {
    let minDist = Infinity;

    for (let t = 0; t <= 1; t += 0.01) {
      const u = 1 - t;
      const testPoint = new SheetPosition(
        u * u * start.x + 2 * u * t * control.x + t * t * end.x,
        u * u * start.y + 2 * u * t * control.y + t * t * end.y,
      );
      const dist = distance(testPoint, point);
      if (dist < minDist) {
        minDist = dist;
      }
    }

    return minDist;
  }

  private closestPointOnCubicBezier(
    start: SheetPosition,
    control1: SheetPosition,
    control2: SheetPosition,
    end: SheetPosition,
    point: SheetPosition
  ): SheetPosition {
    let minDist = Infinity;
    let bestPoint = start;

    for (let t = 0; t <= 1; t += 0.01) {
      const u = 1 - t;
      const uu = u * u;
      const tt = t * t;
      const uuu = uu * u;
      const ttt = tt * t;

      const testPoint = new SheetPosition(
        uuu * start.x + 3 * uu * t * control1.x + 3 * u * tt * control2.x + ttt * end.x,
        uuu * start.y + 3 * uu * t * control1.y + 3 * u * tt * control2.y + ttt * end.y,
      );
      const dist = distance(testPoint, point);
      if (dist < minDist) {
        minDist = dist;
        bestPoint = testPoint;
      }
    }

    return bestPoint;
  }

  private distanceToCubicBezier(
    start: SheetPosition,
    control1: SheetPosition,
    control2: SheetPosition,
    end: SheetPosition,
    point: SheetPosition
  ): number {
    let minDist = Infinity;

    for (let t = 0; t <= 1; t += 0.01) {
      const u = 1 - t;
      const uu = u * u;
      const tt = t * t;
      const uuu = uu * u;
      const ttt = tt * t;

      const testPoint = new SheetPosition(
        uuu * start.x + 3 * uu * t * control1.x + 3 * u * tt * control2.x + ttt * end.x,
        uuu * start.y + 3 * uu * t * control1.y + 3 * u * tt * control2.y + ttt * end.y,
      );
      const dist = distance(testPoint, point);
      if (dist < minDist) {
        minDist = dist;
      }
    }

    return minDist;
  }

  private distanceToEllipse(ellipse: { center: SheetPosition; radiusX: number; radiusY: number }, point: SheetPosition): number {
    const dx = point.x - ellipse.center.x;
    const dy = point.y - ellipse.center.y;
    const normalizedDist = Math.sqrt((dx * dx) / (ellipse.radiusX * ellipse.radiusX) + (dy * dy) / (ellipse.radiusY * ellipse.radiusY));

    return Math.abs(normalizedDist - 1) * Math.min(ellipse.radiusX, ellipse.radiusY);
  }

  private getSegmentPoint(seg: PolygonSegment): SheetPosition {
    if (seg.type === 'point') {
      return seg.point;
    } else if (seg.type === 'arc-quadratic') {
      return seg.point;
    } else {
      return seg.point;
    }
  }

  private getRectangleEdges(rectangle: { upperLeft: SheetPosition; lowerRight: SheetPosition }): Array<{ start: SheetPosition; end: SheetPosition }> {
    const { upperLeft, lowerRight } = rectangle;
    const upperRight = new SheetPosition(lowerRight.x, upperLeft.y);
    const lowerLeft = new SheetPosition(upperLeft.x, lowerRight.y);

    return [
      { start: upperLeft, end: upperRight },
      { start: upperRight, end: lowerRight },
      { start: lowerRight, end: lowerLeft },
      { start: lowerLeft, end: upperLeft },
    ];
  }

  private computePreviewIntersections(hovered: HoveredSegment, clickPos: SheetPosition): void {
    const intersections: Array<IntersectionPreview> = [];

    if (hovered.shapeType === 'polygon') {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === hovered.shapeId);
      if (!polygon) return;

      const seg = polygon.points[hovered.segmentIndex];
      const nextSeg = polygon.points[hovered.segmentIndex + 1];
      if (!seg || !nextSeg) return;

      const segmentStart = this.getSegmentPoint(seg);
      const segmentEnd = this.getSegmentPoint(nextSeg);

      console.log('[TrimSplit] Computing intersections for segment:', hovered.segmentIndex, 'from', segmentStart.x, segmentStart.y, 'to', segmentEnd.x, segmentEnd.y);

      for (const otherPolygon of this.getGeometryStore().polygons) {
        if (otherPolygon.id === hovered.shapeId) continue;

        for (let i = 0; i < otherPolygon.points.length - 1; i++) {
          const otherSeg = otherPolygon.points[i];
          const otherNextSeg = otherPolygon.points[i + 1];

          if (otherSeg.type !== 'point' || otherNextSeg.type !== 'point') continue;

          const intersection = computeLineSegmentIntersection(
            { start: segmentStart, end: segmentEnd },
            { start: otherSeg.point, end: otherNextSeg.point }
          );

          if (intersection) {
            console.log('[TrimSplit]   Found intersection with polygon', otherPolygon.id, 'segment', i, 'at', intersection.x, intersection.y);
            intersections.push({
              point: intersection,
              willCreateOn: { id: otherPolygon.id, segmentIndex: i },
            });
          }
        }
      }

      console.log('[TrimSplit] Total intersections found:', intersections.length);
    }

    this.previewIntersections = intersections;
    this.emit('previewIntersectionsChange', intersections);
  }

  private performTrimOrSplit(hovered: HoveredSegment, clickPos: SheetPosition): void {
    console.log('[TrimSplit] performTrimOrSplit - hovered:', hovered.shapeId, hovered.shapeType, hovered.segmentIndex);

    if (hovered.shapeType === 'rectangle') {
      console.log('[TrimSplit] Converting rectangle to polygon');
      const polygon = this.getGeometryStore().replaceRectangleWithPolygon(hovered.shapeId);
      if (!polygon) {
        console.log('[TrimSplit] Failed to convert rectangle to polygon');
        return;
      }

      hovered = {
        shapeId: polygon.id,
        shapeType: 'polygon',
        segmentIndex: hovered.segmentIndex,
        closestPoint: hovered.closestPoint,
      };
    } else if (hovered.shapeType === 'ellipse') {
      console.log('[TrimSplit] Converting ellipse to polygon');
      const polygon = this.getGeometryStore().replaceEllipseWithPolygon(hovered.shapeId);
      if (!polygon) {
        console.log('[TrimSplit] Failed to convert ellipse to polygon');
        return;
      }

      hovered = {
        shapeId: polygon.id,
        shapeType: 'polygon',
        segmentIndex: hovered.segmentIndex,
        closestPoint: hovered.closestPoint,
      };
    }

    if (hovered.shapeType === 'polygon') {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === hovered.shapeId);
      if (!polygon) {
        console.log('[TrimSplit] Polygon not found:', hovered.shapeId);
        return;
      }

      console.log('[TrimSplit] Polygon points before:', polygon.points.length);
      console.log('[TrimSplit] Segment index:', hovered.segmentIndex);

      const seg = polygon.points[hovered.segmentIndex];
      const nextSeg = polygon.points[hovered.segmentIndex + 1];
      if (!seg || !nextSeg) {
        console.log('[TrimSplit] Segment not found at index');
        return;
      }

      const segmentStart = this.getSegmentPoint(seg);
      const segmentEnd = this.getSegmentPoint(nextSeg);

      console.log('[TrimSplit] Segment from:', segmentStart.x, segmentStart.y, 'to', segmentEnd.x, segmentEnd.y);

      // Find the nearest intersection with OTHER geometry
      let nearestIntersection: SheetPosition | null = null;
      let minIntersectionDist = Infinity;

      for (const otherPolygon of this.getGeometryStore().polygons) {
        if (otherPolygon.id === hovered.shapeId) continue;

        for (let i = 0; i < otherPolygon.points.length - 1; i++) {
          const otherSeg = otherPolygon.points[i];
          const otherNextSeg = otherPolygon.points[i + 1];

          if (otherSeg.type !== 'point' || otherNextSeg.type !== 'point') continue;

          const intersection = computeLineSegmentIntersection(
            { start: segmentStart, end: segmentEnd },
            { start: otherSeg.point, end: otherNextSeg.point }
          );

          if (intersection) {
            const distToClick = distance(intersection, clickPos);
            console.log('[TrimSplit]   Intersection with polygon', otherPolygon.id, 'segment', i, 'at', intersection.x, intersection.y, 'dist to click:', distToClick);
            
            if (distToClick < minIntersectionDist) {
              minIntersectionDist = distToClick;
              nearestIntersection = intersection;
            }
          }
        }
      }

      // Determine the trim point
      let trimPoint: SheetPosition;
      
      if (nearestIntersection && minIntersectionDist < 1) {
        // Use intersection point if it's close to click
        trimPoint = nearestIntersection;
        console.log('[TrimSplit] Using intersection point:', trimPoint.x, trimPoint.y);
      } else {
        // Otherwise use the closest point on the segment to the click
        trimPoint = closestPointOnSegment(segmentStart, segmentEnd, clickPos);
        console.log('[TrimSplit] Using closest point on segment:', trimPoint.x, trimPoint.y, '(no nearby intersection)');
      }

      if (this.mode === 'split') {
        console.log('[TrimSplit] Performing SPLIT at point:', trimPoint.x, trimPoint.y);
        this.getGeometryStore().splitPolygonSegment(
          hovered.shapeId,
          hovered.segmentIndex,
          trimPoint
        );
      } else {
        console.log('[TrimSplit] Performing DELETE on segment:', hovered.segmentIndex);
        // Delete just breaks the ring - we remove the segment between two adjacent points
        // but keep the vertices. We insert intersection points where needed but don't cascade.
        this.getGeometryStore().deletePolygonSegmentOnly(
          hovered.shapeId,
          hovered.segmentIndex,
          trimPoint
        );
      }
      
      console.log('[TrimSplit] Operation complete');
    }

    this.clearHoverState();
  }
}
