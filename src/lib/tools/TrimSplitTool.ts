import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { Id, type Polygon, type PolygonSegment, type PointSegment, type QuadraticBezierSegment, type CubicBezierSegment } from './types';
import { distance, computeLineSegmentIntersection, lineSegmentBoundingBox, CohenSutherland } from '../math';

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
  point: SheetPosition;
};

export type IntersectionPreview = {
  point: SheetPosition;
  willCreateOn: { id: Id; segmentIndex: number };
};

const HOVER_DISTANCE_THRESHOLD = 20;

export class TrimSplitTool extends BaseTool<TrimSplitToolEvents> {
  type = 'trim-split' as const;

  mode: TrimMode = 'delete';

  hoveredSegment: HoveredSegment | null = null;
  previewIntersections: Array<IntersectionPreview> = [];

  handleToolBlur(): void {
    this.clearHoverState();
  }

  getCursor(): string {
    return 'pointer';
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const closestSegment = this.findClosestSegment(sheetPos, viewport);

    if (closestSegment !== this.hoveredSegment) {
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
      return;
    }

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    this.performTrimOrSplit(this.hoveredSegment, sheetPos);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'x' || event.key === 'X') {
      this.mode = this.mode === 'split' ? 'delete' : 'split';
      this.emit('modeChange', this.mode);

      if (this.hoveredSegment) {
        this.computePreviewIntersections(this.hoveredSegment, this.hoveredSegment.point);
      }
    } else if (event.key === 'Escape') {
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
      for (let i = 0; i < polygon.points.length - 1; i++) {
        const seg = polygon.points[i];
        const nextSeg = polygon.points[i + 1];

        const segmentDist = this.distanceToSegment(seg, nextSeg, sheetPos);

        if (segmentDist < minDist) {
          minDist = segmentDist;
          closest = {
            shapeId: polygon.id,
            shapeType: 'polygon',
            segmentIndex: i,
            point: this.getSegmentPoint(seg),
          };
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
          closest = {
            shapeId: rectangle.id,
            shapeType: 'rectangle',
            segmentIndex: i,
            point: sheetPos,
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
          point: sheetPos,
        };
      }
    }

    return closest;
  }

  private distanceToSegment(
    seg: PolygonSegment,
    nextSeg: PolygonSegment,
    point: SheetPosition
  ): number {
    if (seg.type === 'point' && nextSeg.type === 'point') {
      return this.distanceToLineSegment(seg.point, nextSeg.point, point);
    }

    if (seg.type === 'arc-quadratic' && nextSeg.type === 'point') {
      return this.distanceToQuadraticBezier(seg.point, seg.controlPoint, nextSeg.point, point);
    }

    if (seg.type === 'arc-cubic' && nextSeg.type === 'point') {
      return this.distanceToCubicBezier(seg.point, seg.controlPointA, seg.controlPointB, nextSeg.point, point);
    }

    return Infinity;
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

  private distanceToQuadraticBezier(
    start: SheetPosition,
    control: SheetPosition,
    end: SheetPosition,
    point: SheetPosition
  ): number {
    let minDist = Infinity;

    for (let t = 0; t <= 1; t += 0.05) {
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

  private distanceToCubicBezier(
    start: SheetPosition,
    control1: SheetPosition,
    control2: SheetPosition,
    end: SheetPosition,
    point: SheetPosition
  ): number {
    let minDist = Infinity;

    for (let t = 0; t <= 1; t += 0.05) {
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
            intersections.push({
              point: intersection,
              willCreateOn: { id: otherPolygon.id, segmentIndex: i },
            });
          }
        }
      }
    }

    this.previewIntersections = intersections;
    this.emit('previewIntersectionsChange', intersections);
  }

  private performTrimOrSplit(hovered: HoveredSegment, clickPos: SheetPosition): void {
    if (hovered.shapeType === 'rectangle') {
      const polygon = this.getGeometryStore().replaceRectangleWithPolygon(hovered.shapeId);
      if (!polygon) return;

      hovered = {
        shapeId: polygon.id,
        shapeType: 'polygon',
        segmentIndex: hovered.segmentIndex,
        point: hovered.point,
      };
    } else if (hovered.shapeType === 'ellipse') {
      const polygon = this.getGeometryStore().replaceEllipseWithPolygon(hovered.shapeId);
      if (!polygon) return;

      hovered = {
        shapeId: polygon.id,
        shapeType: 'polygon',
        segmentIndex: hovered.segmentIndex,
        point: hovered.point,
      };
    }

    if (hovered.shapeType === 'polygon') {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === hovered.shapeId);
      if (!polygon) return;

      const seg = polygon.points[hovered.segmentIndex];
      const nextSeg = polygon.points[hovered.segmentIndex + 1];
      if (!seg || !nextSeg) return;

      const segmentStart = this.getSegmentPoint(seg);
      const segmentEnd = this.getSegmentPoint(nextSeg);

      const intersection = computeLineSegmentIntersection(
        { start: segmentStart, end: segmentEnd },
        { start: clickPos, end: clickPos }
      );

      const trimPoint = intersection ?? clickPos;

      if (this.mode === 'split') {
        this.getGeometryStore().splitPolygonSegment(
          hovered.shapeId,
          hovered.segmentIndex,
          trimPoint
        );
      } else {
        const cascadeTargets: Array<{ id: Id; segmentIndex: number }> = [];

        for (const otherPolygon of this.getGeometryStore().polygons) {
          if (otherPolygon.id === hovered.shapeId) continue;

          for (let i = 0; i < otherPolygon.points.length - 1; i++) {
            const otherSeg = otherPolygon.points[i];
            const otherNextSeg = otherPolygon.points[i + 1];

            if (otherSeg.type !== 'point' || otherNextSeg.type !== 'point') continue;

            const intersectionPoint = computeLineSegmentIntersection(
              { start: segmentStart, end: segmentEnd },
              { start: otherSeg.point, end: otherNextSeg.point }
            );

            if (intersectionPoint) {
              const distToTrim = distance(intersectionPoint, trimPoint);
              if (distToTrim < 0.001) {
                cascadeTargets.push({ id: otherPolygon.id, segmentIndex: i });
              }
            }
          }
        }

        this.getGeometryStore().deletePolygonSegment(
          hovered.shapeId,
          hovered.segmentIndex,
          cascadeTargets
        );
      }
    }

    this.clearHoverState();
  }
}
