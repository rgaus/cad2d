import EventEmitter from 'eventemitter3';
import { HistoryManager } from '../history/HistoryManager';
import type { Id, Polygon, WorkingPolygon, Rectangle, WorkingRectangle, Ellipse, WorkingEllipse, PolygonSegment, PointSegment, QuadraticBezierSegment, CubicBezierSegment } from './types';
import { SheetPosition } from '../viewport/types';
import { DeCasteljau, ellipseToPolygon, rectangleToPolygon } from '../math';

/** Default color for newly created geometry. */
export const DEFAULT_COLOR = 0x8d8d8d;

/** Events emitted by GeometryStore. */
export type GeometryStoreEvents = {
  polygonAdded: (polygon: Polygon) => void;
  polygonsChanged: (polygons: Array<Polygon>) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
  rectangleAdded: (rectangle: Rectangle) => void;
  rectanglesChanged: (rectangles: Array<Rectangle>) => void;
  workingRectangleChanged: (wr: WorkingRectangle | null) => void;
  ellipseAdded: (ellipse: Ellipse) => void;
  ellipsesChanged: (ellipses: Array<Ellipse>) => void;
  workingEllipseChanged: (we: WorkingEllipse | null) => void;
};

/**
 * Stores all completed geometry (polygons, rectangles, ellipses) and the currently-drawn working shapes.
 * All mutating operations are recorded to the HistoryManager for undo/redo.
 */
export class GeometryStore extends EventEmitter<GeometryStoreEvents> {
  polygons: Array<Polygon> = [];
  rectangles: Array<Rectangle> = [];
  ellipses: Array<Ellipse> = [];

  workingPolygon: WorkingPolygon | null = null;
  workingRectangle: WorkingRectangle | null = null;
  workingEllipse: WorkingEllipse | null = null;

  private readonly historyManager: HistoryManager;

  constructor(historyManager: HistoryManager) {
    super();
    this.historyManager = historyManager;
  }

  // ==================== POLYGON METHODS ====================

  /**
   * Adds a polygon, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addPolygon(polygon: Omit<Polygon, 'id'>): Polygon {
    const id = this.historyManager.generateStableId();
    const fullPolygon: Polygon = { ...polygon, id };

    const polygons = this.polygons.slice();
    polygons.push(fullPolygon);
    this.polygons = polygons;

    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', fullPolygon);
    return fullPolygon;
  }

  /**
   * Internal version of addPolygon that uses an existing polygon with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addPolygonDirect(polygon: Polygon): void {
    const polygons = this.polygons.slice();
    polygons.push(polygon);
    this.polygons = polygons;

    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', polygon);
  }

  getPolygonById(id: Id): Polygon | null {
    return this.polygons.find(p => p.id === id) ?? null;
  }

  /** Updates a polygon by id, recording the change to history. */
  updatePolygon(id: Id, updatesOrFn: Partial<Polygon> | ((old: Polygon) => Polygon)): void {
    const index = this.polygons.findIndex(p => p.id === id);
    if (index < 0) {
      return;
    }

    const before = this.polygons[index];
    let after: Polygon;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    const polygons = this.polygons.slice();
    polygons[index] = after;
    this.polygons = polygons;

    if (after.points && after.points !== before.points) {
      this.historyManager.recordPolygonMove(id, before.points, after.points);
    }
    this.emit('polygonsChanged', this.polygons);
  }

  /** Deletes a polygon by id, recording the deletion to history. */
  deletePolygon(id: Id): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (polygon) {
      this.polygons = this.polygons.filter(p => p.id !== id);
      this.historyManager.recordPolygonDelete(polygon);
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /**
   * Internal version of deletePolygon that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deletePolygonDirect(id: Id): void {
    this.polygons = this.polygons.filter(p => p.id !== id);
    this.emit('polygonsChanged', this.polygons);
  }

  /**
   * Inserts a new point segment at the specified position, splitting the edge between
   * segmentIndex and segmentIndex+1. Only works for point-type segments.
   * Records the insertion to history for undo/redo.
   */
  addPointOnEdge(polygonId: Id, segmentIndex: number, newPoint: SheetPosition): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.map(seg => ({ ...seg }));

    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return;
    }

    if (segment.type !== 'point' || nextSegment.type !== 'point') {
      return;
    }

    const newSegment: PointSegment = { type: 'point', point: newPoint };
    const afterSegments = [
      ...polygon.points.slice(0, segmentIndex + 1),
      newSegment,
      ...polygon.points.slice(segmentIndex + 1),
    ];

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return { ...p, points: afterSegments };
      }
      return p;
    });

    this.historyManager.recordPolygonInsertPoint(polygonId, segmentIndex, newPoint, beforeSegments, afterSegments);
    this.emit('polygonsChanged', this.polygons);
  }

  setWorkingPolygon(wp: WorkingPolygon | null): void {
    this.workingPolygon = wp;
    this.emit('workingPolygonChanged', wp);
  }

  clearWorkingPolygon(): void {
    this.workingPolygon = null;
    this.emit('workingPolygonChanged', null);
  }

  /** Sets the fill color of a polygon, recording the change to history. */
  setPolygonFillColor(id: Id, color: number | null): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    const beforeColor = polygon.fillColor;
    if (beforeColor === color) return;
    this.updatePolygon(id, { fillColor: color });
    this.historyManager.recordPolygonFillColor(id, beforeColor, color);
  }

  /** Sets the openAtIndex of a polygon. Automatically bounds to valid range. */
  setPolygonOpenAtIndex(id: Id, index: number): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    const boundedIndex = Math.max(0, Math.min(index, polygon.points.length - 1));
    if (polygon.openAtIndex === boundedIndex) return;
    this.updatePolygon(id, { openAtIndex: boundedIndex });
  }

  /** Closes a polygon, recording the change to history. */
  closePolygon(id: Id): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon || polygon.closed) return;
    this.updatePolygon(id, { closed: true });
    this.historyManager.recordPolygonClose(id, false, true);
  }

  /** Opens a polygon, recording the change to history. */
  openPolygon(id: Id): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon || !polygon.closed) return;
    this.updatePolygon(id, { closed: false });
    this.historyManager.recordPolygonClose(id, true, false);
  }

  /** Clears all polygons, recording each deletion to history. */
  clearAllPolygons(): void {
    for (const polygon of this.polygons) {
      this.historyManager.recordPolygonDelete(polygon);
    }
    this.polygons = [];
    this.emit('polygonsChanged', this.polygons);
  }

  /**
   * Splits a segment at newPoint, inserting the point but not deleting anything.
   * If cascadedId provided, also splits the other shape at that point.
   * For Bezier curves, uses De Casteljau's algorithm to split exactly at the parameter t.
   */
  splitPolygonSegment(
    polygonId: Id,
    segmentIndex: number,
    newPoint: SheetPosition,
    cascadedId?: Id,
    cascadedSegmentIndex?: number,
    cascadedNewPoint?: SheetPosition,
  ): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.map(seg => ({ ...seg }));
    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return;
    }

    let afterSegments: Array<PolygonSegment>;

    if (segment.type === 'point' && nextSegment.type === 'point') {
      const newSegment: PointSegment = { type: 'point', point: newPoint };
      afterSegments = [
        ...polygon.points.slice(0, segmentIndex + 1),
        newSegment,
        ...polygon.points.slice(segmentIndex + 1),
      ];
    } else if (segment.type === 'arc-quadratic') {
      const t = this.computeQuadraticBezierT(segment.point, segment.controlPoint, nextSegment.point, newPoint);
      if (t === null) {
        return;
      }
      const [left, right] = DeCasteljau.splitQuadraticBezier(
        segment.point,
        segment.controlPoint,
        nextSegment.point,
        t
      );
      afterSegments = [
        ...polygon.points.slice(0, segmentIndex),
        left,
        { type: 'point', point: newPoint },
        right,
        ...polygon.points.slice(segmentIndex + 2),
      ];
    } else if (segment.type === 'arc-cubic') {
      const t = this.computeCubicBezierT(segment.point, segment.controlPointA, segment.controlPointB, nextSegment.point, newPoint);
      if (t === null) {
        return;
      }
      const [left, right] = DeCasteljau.splitCubicBezier(
        segment.point,
        segment.controlPointA,
        segment.controlPointB,
        nextSegment.point,
        t
      );
      afterSegments = [
        ...polygon.points.slice(0, segmentIndex),
        left,
        { type: 'point', point: newPoint },
        right,
        ...polygon.points.slice(segmentIndex + 2),
      ];
    } else {
      return;
    }

    let cascadedBeforeSegments: Array<PolygonSegment> | undefined;
    let cascadedAfterSegments: Array<PolygonSegment> | undefined;

    if (cascadedId && cascadedSegmentIndex !== undefined && cascadedNewPoint) {
      const cascadedPolygon = this.polygons.find(p => p.id === cascadedId);
      if (cascadedPolygon) {
        cascadedBeforeSegments = cascadedPolygon.points.map(seg => ({ ...seg }));
        cascadedAfterSegments = this.insertPointIntoPolygon(cascadedPolygon, cascadedSegmentIndex, cascadedNewPoint);
      }
    }

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return { ...p, points: afterSegments };
      }
      if (cascadedId && p.id === cascadedId && cascadedAfterSegments) {
        return { ...p, points: cascadedAfterSegments };
      }
      return p;
    });

    this.historyManager.recordPolygonSplit(polygonId, segmentIndex, newPoint, beforeSegments, afterSegments, {
      cascadedId,
      cascadedSegmentIndex,
      cascadedNewPoint,
      cascadedBeforeSegments,
      cascadedAfterSegments,
    });
    this.emit('polygonsChanged', this.polygons);
  }

  /**
   * Deletes a segment entirely from a polygon.
   * Cascades to any intersected shapes via cascadeTargets.
   */
  deletePolygonSegment(
    polygonId: Id,
    segmentIndex: number,
    cascadeTargets?: Array<{ id: Id; segmentIndex: number }>,
  ): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.map(seg => ({ ...seg }));

    const afterSegments = polygon.points.filter((_, i) => i !== segmentIndex && i !== segmentIndex + 1);

    const cascadedDeletes: Array<{
      id: Id;
      segmentIndex: number;
      beforeSegments: Array<PolygonSegment>;
      afterSegments: Array<PolygonSegment>;
    }> = [];

    for (const target of cascadeTargets ?? []) {
      const targetPolygon = this.polygons.find(p => p.id === target.id);
      if (targetPolygon) {
        const targetBefore = targetPolygon.points.map(seg => ({ ...seg }));
        const targetAfter = targetPolygon.points.filter((_, i) => i !== target.segmentIndex && i !== target.segmentIndex + 1);
        cascadedDeletes.push({
          id: target.id,
          segmentIndex: target.segmentIndex,
          beforeSegments: targetBefore,
          afterSegments: targetAfter,
        });
      }
    }

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return { ...p, points: afterSegments };
      }
      for (const cascaded of cascadedDeletes) {
        if (p.id === cascaded.id) {
          return { ...p, points: cascaded.afterSegments };
        }
      }
      return p;
    });

    this.historyManager.recordPolygonTrimDelete(polygonId, segmentIndex, beforeSegments, afterSegments, cascadedDeletes);
    this.emit('polygonsChanged', this.polygons);
  }

  /**
   * Breaks a closed polygon at a segment by marking it as open.
   * Does NOT delete any vertices or cascade to other shapes.
   * Inserts intersection points where needed but keeps the polygon structure intact.
   */
  deletePolygonSegmentOnly(
    polygonId: Id,
    segmentIndex: number,
    intersectionPoint?: SheetPosition,
  ): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.map(seg => ({ ...seg }));
    let afterSegments = [...polygon.points];

    // If intersection point provided and segment is a line, insert points on both sides
    if (intersectionPoint) {
      const seg = polygon.points[segmentIndex];
      const nextSeg = polygon.points[segmentIndex + 1];

      if (seg && nextSeg && seg.type === 'point' && nextSeg.type === 'point') {
        // Insert the intersection point after segmentIndex
        afterSegments = [
          ...polygon.points.slice(0, segmentIndex + 1),
          { type: 'point' as const, point: intersectionPoint },
          ...polygon.points.slice(segmentIndex + 1),
        ];
      }
    }

    // Mark the polygon as open at the segment index
    const updatedPolygon: Polygon = {
      ...polygon,
      points: afterSegments,
      closed: false,
      openAtIndex: segmentIndex,
    };

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return updatedPolygon;
      }
      return p;
    });

    this.historyManager.recordPolygonOpen(polygonId, segmentIndex, beforeSegments, afterSegments);
    this.emit('polygonsChanged', this.polygons);
  }

  /**
   * Converts a rectangle to a polygon representation.
   * The rectangle is deleted and replaced with a polygon.
   */
  replaceRectangleWithPolygon(rectangleId: Id): Polygon | null {
    const rectangle = this.rectangles.find(r => r.id === rectangleId);
    if (!rectangle) {
      return null;
    }

    const polygonSegments = rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight);
    polygonSegments.push({ type: 'point', point: rectangle.upperLeft });

    const polygon = this.addPolygon({
      points: polygonSegments,
      closed: true,
      fillColor: null,
      openAtIndex: 0,
    });

    this.historyManager.recordRectangleReplace(rectangle, polygon);
    this.rectangles = this.rectangles.filter(r => r.id !== rectangleId);
    this.emit('rectanglesChanged', this.rectangles);

    return polygon;
  }

  /**
   * Converts an ellipse to a polygon representation.
   * The ellipse is deleted and replaced with a polygon.
   */
  replaceEllipseWithPolygon(ellipseId: Id): Polygon | null {
    const ellipse = this.ellipses.find(e => e.id === ellipseId);
    if (!ellipse) {
      return null;
    }

    const polygonSegments = ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY);
    polygonSegments.push({ type: 'point', point: polygonSegments[0].point });

    const polygon = this.addPolygon({
      points: polygonSegments,
      closed: true,
      fillColor: null,
      openAtIndex: 0,
    });

    this.historyManager.recordEllipseReplace(ellipse, polygon);
    this.ellipses = this.ellipses.filter(e => e.id !== ellipseId);
    this.emit('ellipsesChanged', this.ellipses);

    return polygon;
}

  /**
   * Computes the parameter t on a quadratic Bezier curve where the point lies.
   * Returns null if the point is not on the curve (within tolerance).
   */
  private computeQuadraticBezierT(
    start: SheetPosition,
    control: SheetPosition,
    end: SheetPosition,
    point: SheetPosition,
    tolerance: number = 0.01,
  ): number | null {
    const ax = start.x - 2 * control.x + end.x;
    const ay = start.y - 2 * control.y + end.y;
    const bx = 2 * control.x - 2 * start.x;
    const by = 2 * control.y - 2 * start.y;
    const cx = start.x - point.x;
    const cy = start.y - point.y;

    const d = Math.sqrt(ax * ax + ay * ay);
    if (d < 0.0001) {
      return null;
    }

    const discriminant = bx * bx - 4 * ax * cx;
    if (discriminant < 0) {
      return null;
    }

    const t1 = (-bx + Math.sqrt(discriminant)) / (2 * ax);
    const t2 = (-bx - Math.sqrt(discriminant)) / (2 * ax);

    const candidates = [t1, t2].filter(t => t >= 0 && t <= 1);

    for (const t of candidates) {
      const testPoint = new SheetPosition(
        (1 - t) * (1 - t) * start.x + 2 * (1 - t) * t * control.x + t * t * end.x,
        (1 - t) * (1 - t) * start.y + 2 * (1 - t) * t * control.y + t * t * end.y,
      );
      const dist = Math.sqrt((testPoint.x - point.x) ** 2 + (testPoint.y - point.y) ** 2);
      if (dist < tolerance) {
        return t;
      }
    }

    return null;
  }

  /**
   * Computes the parameter t on a cubic Bezier curve where the point lies.
   * Returns null if the point is not on the curve (within tolerance).
   */
  private computeCubicBezierT(
    start: SheetPosition,
    control1: SheetPosition,
    control2: SheetPosition,
    end: SheetPosition,
    point: SheetPosition,
    tolerance: number = 0.01,
  ): number | null {
    for (let t = 0; t <= 1; t += 0.01) {
      const testPoint = this.evaluateCubicBezier(start, control1, control2, end, t);
      const dist = Math.sqrt((testPoint.x - point.x) ** 2 + (testPoint.y - point.y) ** 2);
      if (dist < tolerance) {
        return t;
      }
    }
    return null;
  }

  private evaluateCubicBezier(
    p0: SheetPosition,
    p1: SheetPosition,
    p2: SheetPosition,
    p3: SheetPosition,
    t: number,
  ): SheetPosition {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    return new SheetPosition(
      uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    );
  }

  private insertPointIntoPolygon(
    polygon: Polygon,
    segmentIndex: number,
    newPoint: SheetPosition,
  ): Array<PolygonSegment> {
    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return polygon.points;
    }

    if (segment.type === 'point' && nextSegment.type === 'point') {
      const newSegment: PointSegment = { type: 'point', point: newPoint };
      return [
        ...polygon.points.slice(0, segmentIndex + 1),
        newSegment,
        ...polygon.points.slice(segmentIndex + 1),
      ];
    }

    return polygon.points;
  }

// ==================== RECTANGLE METHODS ====================

  /**
   * Adds a rectangle, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addRectangle(rectangle: Omit<Rectangle, 'id'>): Rectangle {
    const id = this.historyManager.generateStableId();
    const fullRectangle: Rectangle = { ...rectangle, id };
    this.rectangles.push(fullRectangle);
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('rectangleAdded', fullRectangle);
    return fullRectangle;
  }

  /**
   * Internal version of addRectangle that uses an existing rectangle with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addRectangleDirect(rectangle: Rectangle): void {
    this.rectangles.push(rectangle);
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('rectangleAdded', rectangle);
  }

  getRectangleById(id: Id): Rectangle | null {
    return this.rectangles.find(r => r.id === id) ?? null;
  }

  /** Updates a rectangle by id, recording the change to history. */
  updateRectangle(id: Id, updatesOrFn: Partial<Rectangle> | ((old: Rectangle) => Rectangle)): void {
    const index = this.rectangles.findIndex(r => r.id === id);
    if (index < 0) {
      return;
    }

    const before = this.rectangles[index];
    let after: Rectangle;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.rectangles[index] = after;
    if (after.upperLeft !== before.upperLeft || after.lowerRight !== before.lowerRight) {
      this.historyManager.recordRectangleMove(id, before, after);
    }
    this.emit('rectanglesChanged', this.rectangles);
  }

  /** Deletes a rectangle by id, recording the deletion to history. */
  deleteRectangle(id: Id): void {
    const rectangle = this.rectangles.find(r => r.id === id);
    if (rectangle) {
      this.rectangles = this.rectangles.filter(r => r.id !== id);
      this.historyManager.recordRectangleDelete(rectangle);
      this.emit('rectanglesChanged', this.rectangles);
    }
  }

  /**
   * Internal version of deleteRectangle that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteRectangleDirect(id: Id): void {
    this.rectangles = this.rectangles.filter(r => r.id !== id);
    this.emit('rectanglesChanged', this.rectangles);
  }

  setWorkingRectangle(wr: WorkingRectangle | null): void {
    this.workingRectangle = wr;
    this.emit('workingRectangleChanged', wr);
  }

  clearWorkingRectangle(): void {
    this.workingRectangle = null;
    this.emit('workingRectangleChanged', null);
  }

  /** Sets the fill color of a rectangle, recording the change to history. */
  setRectangleFillColor(id: Id, color: number | null): void {
    const rectangle = this.rectangles.find(r => r.id === id);
    if (!rectangle) return;
    const beforeColor = rectangle.fillColor;
    if (beforeColor === color) return;
    const index = this.rectangles.findIndex(r => r.id === id);
    this.rectangles[index] = { ...this.rectangles[index], fillColor: color };
    this.historyManager.recordRectangleFillColor(id, beforeColor, color);
    this.emit('rectanglesChanged', this.rectangles);
  }

  /** Sets the linkDimensions flag of a rectangle, recording the change to history. */
  setRectangleLinkDimensions(id: Id, link: boolean): void {
    const rectangle = this.rectangles.find(r => r.id === id);
    if (!rectangle) return;
    const beforeLink = rectangle.linkDimensions;
    if (beforeLink === link) return;
    const index = this.rectangles.findIndex(r => r.id === id);
    this.rectangles[index] = { ...this.rectangles[index], linkDimensions: link };
    this.historyManager.recordRectangleLinkDimensions(id, beforeLink, link);
    this.emit('rectanglesChanged', this.rectangles);
  }

  // ==================== ELLIPSE METHODS ====================

  /**
   * Adds an ellipse, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addEllipse(ellipse: Omit<Ellipse, 'id'>): Ellipse {
    const id = this.historyManager.generateStableId();
    const fullEllipse: Ellipse = { ...ellipse, id };
    this.ellipses.push(fullEllipse);
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('ellipseAdded', fullEllipse);
    return fullEllipse;
  }

  /**
   * Internal version of addEllipse that uses an existing ellipse with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addEllipseDirect(ellipse: Ellipse): void {
    this.ellipses.push(ellipse);
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('ellipseAdded', ellipse);
  }

  getEllipseById(id: Id): Ellipse | null {
    return this.ellipses.find(e => e.id === id) ?? null;
  }

  /** Updates an ellipse by id, recording the change to history. */
  updateEllipse(id: Id, updatesOrFn: Partial<Ellipse> | ((old: Ellipse) => Ellipse)): void {
    const index = this.ellipses.findIndex(e => e.id === id);
    if (index < 0) {
      return;
    }

    const before = this.ellipses[index];
    let after: Ellipse;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.ellipses[index] = after;
    if (after.center !== before.center || after.radiusX !== before.radiusX || after.radiusY !== before.radiusY) {
      this.historyManager.recordEllipseMove(id, before, after);
    }
    this.emit('ellipsesChanged', this.ellipses);
  }

  /** Deletes an ellipse by id, recording the deletion to history. */
  deleteEllipse(id: Id): void {
    const ellipse = this.ellipses.find(e => e.id === id);
    if (ellipse) {
      this.ellipses = this.ellipses.filter(e => e.id !== id);
      this.historyManager.recordEllipseDelete(ellipse);
      this.emit('ellipsesChanged', this.ellipses);
    }
  }

  /**
   * Internal version of deleteEllipse that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteEllipseDirect(id: Id): void {
    this.ellipses = this.ellipses.filter(e => e.id !== id);
    this.emit('ellipsesChanged', this.ellipses);
  }

  setWorkingEllipse(we: WorkingEllipse | null): void {
    this.workingEllipse = we;
    this.emit('workingEllipseChanged', we);
  }

  clearWorkingEllipse(): void {
    this.workingEllipse = null;
    this.emit('workingEllipseChanged', null);
  }

  /** Sets the fill color of an ellipse, recording the change to history. */
  setEllipseFillColor(id: Id, color: number | null): void {
    const ellipse = this.ellipses.find(e => e.id === id);
    if (!ellipse) return;
    const beforeColor = ellipse.fillColor;
    if (beforeColor === color) return;
    const index = this.ellipses.findIndex(e => e.id === id);
    this.ellipses[index] = { ...this.ellipses[index], fillColor: color };
    this.historyManager.recordEllipseFillColor(id, beforeColor, color);
    this.emit('ellipsesChanged', this.ellipses);
  }

  /** Sets the linkDimensions flag of an ellipse, recording the change to history. */
  setEllipseLinkDimensions(id: Id, link: boolean): void {
    const ellipse = this.ellipses.find(e => e.id === id);
    if (!ellipse) return;
    const beforeLink = ellipse.linkDimensions;
    if (beforeLink === link) return;
    const index = this.ellipses.findIndex(e => e.id === id);
    this.ellipses[index] = { ...this.ellipses[index], linkDimensions: link };
    this.historyManager.recordEllipseLinkDimensions(id, beforeLink, link);
    this.emit('ellipsesChanged', this.ellipses);
  }
}
