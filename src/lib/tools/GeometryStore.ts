import EventEmitter from 'eventemitter3';
import { HistoryManager } from '../history/HistoryManager';
import type { Id, Polygon, WorkingPolygon, Rectangle, WorkingRectangle, Ellipse, WorkingEllipse, PointSegment, PolygonSegment, QuadraticBezierSegment, CubicBezierSegment } from './types';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';
import { ellipseToPolygon, rectangleToPolygon, DeCasteljau } from '../math';

export const PRESET_COLORS_BY_LABEL = {
  "white": 0xffffff,
  "black": 0x000000,
  "slate-lightest": 0xf1f5f9, // var(--slate-1)
  "slate-light": 0xcbd5e1, // var(--slate-4)
  "slate-midlight": 0x94a3b8, // var(--slate-5)
  "slate-mid": 0x64748b, // var(--slate-7)
  "slate-middark": 0x475569, // var(--slate-8)
  "slate-dark": 0x1e293b, // var(--slate-11)
  "slate-darkest": 0x0f172a, // var(--slate-12)
  "red-light": 0xfecaca, // var(--red-3)
  "red-mid": 0xef4444, // var(--red-6)
  "red-dark": 0x991b1b, // var(--red-8)
  "purple-light": 0xe9d5ff, // var(--purple-3)
  "purple-mid": 0xa855f7, // var(--purple-6)
  "purple-dark": 0x7e22ce, // var(--purple-8)
  "blue-light": 0xbfdbfe, // var(--blue-3)
  "blue-mid": 0x3b82f6, // var(--blue-6)
  "blue-dark": 0x1d4ed8, // var(--blue-8)
  "green-light": 0xbbf7d0, // var(--green-3)
  "green-mid": 0x22c55e, // var(--green-6)
  "green-dark": 0x15803d, // var(--green-8)
  "orange-light": 0xfed7aa, // var(--orange-3)
  "orange-mid": 0xf97316, // var(--orange-6)
  "orange-dark": 0xc2410c, // var(--orange-8)
  "yellow-light": 0xfef08a, // var(--yellow-3)
  "yellow-mid": 0xeab308, // var(--yellow-6)
  "yellow-dark": 0xa16207, // var(--yellow-8)
};

export const ID_PREFIXES = {
  polygon: "ply" as const,
  rectangle: "rct" as const,
  ellipse: "elp" as const,
};

/** Default color for newly created geometry. */
export const DEFAULT_COLOR = PRESET_COLORS_BY_LABEL["slate-mid"];

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

  /** Returns the Ids of all geometry items */
  getAllGeometryIds(): Set<Id> {
    return new Set([
      ...this.polygons.map(p => p.id),
      ...this.rectangles.map(r => r.id),
      ...this.ellipses.map(e => e.id),
    ]);
  }

  /** Returns all inner geometry items (polygons, rectangles, ellipses, etc) converted into polygon
    * segments. Used for intersection detection among other things. */
  getAllGeometryAsSegments(): Array<{
    type: 'polygon' | 'rectangle' | 'ellipse';
    id: Id;
    segments: Array<{ index: number, segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition> }>;
  }> {
    const pointsToSegments = (points: Array<PolygonSegment>) => {
      const segments = [];
      let lastPoint = null;
      for (let index = 0; index < points.length; index += 1) {
        const seg = points[index];
        switch (seg.type) {
          case 'point':
            if (lastPoint) {
              segments.push({ index, segment: { start: lastPoint, end: seg.point }});
            }
            break;
          case 'arc-quadratic':
            if (lastPoint) {
              segments.push({
                index,
                segment: {
                  start: lastPoint,
                  end: seg.point,
                  controlPoint: seg.controlPoint,
                },
              });
            }
            break;
          case 'arc-cubic':
            if (lastPoint) {
              segments.push({
                index,
                segment: {
                  start: lastPoint,
                  end: seg.point,
                  controlPointA: seg.controlPointA,
                  controlPointB: seg.controlPointB,
                },
              });
            }
            break;
        }
        lastPoint = seg.point;
      }

      return segments;
    };

    return [
      ...this.polygons.map(p => ({
        type: 'polygon' as const,
        id: p.id,
        segments: pointsToSegments(p.points),
      })),
      ...this.rectangles.map(r => ({
        type: 'rectangle' as const,
        id: r.id,
        segments: pointsToSegments(rectangleToPolygon(r.upperLeft, r.lowerRight)),
      })),
      ...this.ellipses.map(e => ({
        type: 'ellipse' as const,
        id: e.id,
        segments: pointsToSegments(ellipseToPolygon(e.center, e.radiusX, e.radiusY)),
      })),
    ];
  }

  // ==================== POLYGON METHODS ====================

  /**
   * Adds a polygon, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addPolygon(polygon: Omit<Polygon, 'id'>): Polygon {
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);
    const fullPolygon: Polygon = { ...polygon, id };

    const polygons = this.polygons.slice();
    polygons.push(fullPolygon);
    this.polygons = polygons;

    this.historyManager.recordPolygonInsert(fullPolygon);
    this.emit('polygonsChanged', this.polygons.slice());
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

    this.emit('polygonsChanged', this.polygons.slice());
    this.emit('polygonAdded', polygon);
  }

  getPolygonById(id: Id): Polygon | null {
    return this.polygons.find(p => p.id === id) ?? null;
  }

  getPolygonByPoint(point: SheetPosition): Array<[Polygon, number /* point index */]> {
    return this.polygons
      .map(p => [
        p,
        p.points.findIndex(seg => seg.point.x === point.x && seg.point.y === point.y),
      ] as [Polygon, number])
      .filter(entry => entry[1] >= 0);
  }

  /** Finds all point segments across all polygons that are at exactly the same position as the given point. */
  findMatchingPoints(point: SheetPosition, excludePolygonId?: Id): Array<{ polygonId: Id; segmentIndex: number }> {
    const matches: Array<{ polygonId: Id; segmentIndex: number }> = [];
    for (const polygon of this.polygons) {
      if (excludePolygonId && polygon.id === excludePolygonId) {
        continue;
      }
      for (let i = 0; i < polygon.points.length; i++) {
        const seg = polygon.points[i];
        if (seg.type === 'point' && seg.point.x === point.x && seg.point.y === point.y) {
          matches.push({ polygonId: polygon.id, segmentIndex: i });
        }
      }
    }
    return matches;
  }

  /** Updates a polygon by id. Does NOT record to history - use updatePolygon for that.
    * Internal version used by HistoryManager. */
  updatePolygonDirect(id: Id, updatesOrFn: Partial<Polygon> | ((old: Polygon) => Polygon)): void {
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

    this.emit('polygonsChanged', this.polygons.slice());
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
    this.emit('polygonsChanged', this.polygons.slice());
  }

  /** Deletes a polygon by id, recording the deletion to history. */
  deletePolygon(id: Id): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (polygon) {
      this.polygons = this.polygons.filter(p => p.id !== id);

      this.historyManager.recordPolygonDelete(polygon);
      this.emit('polygonsChanged', this.polygons.slice());
    }
  }

  /**
   * Internal version of deletePolygon that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deletePolygonDirect(id: Id): void {
    this.polygons = this.polygons.filter(p => p.id !== id);

    this.emit('polygonsChanged', this.polygons.slice());
  }

  /**
   * Inserts a new point segment at the specified position, splitting the line segment edge
   * between segmentIndex and segmentIndex+1. Only works for point-type segments.
   * Records the insertion to history for undo/redo.
   */
  addPointOnLineSegmentEdge(polygonId: Id, segmentIndex: number, newPoint: SheetPosition): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.slice();

    const segment = polygon.points[segmentIndex];
    const nextSegment = polygon.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return;
    }

    if (nextSegment.type !== 'point') {
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
    this.emit('polygonsChanged', this.polygons.slice());
  }

  /**
   * Inserts a new point segment at the specified position on a quadratic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-quadratic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnQuadraticEdge(polygonId: Id, segmentIndex: number, t: number, newPoint: SheetPosition): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.slice();

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];

    if (!pointSegment || !arcSegment || pointSegment.type !== 'point' || arcSegment.type !== 'arc-quadratic') {
      return;
    }

    const curve = {
      start: pointSegment.point,
      controlPoint: arcSegment.controlPoint,
      end: arcSegment.point,
    };

    const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(curve, t);

    const leftArcSegment: QuadraticBezierSegment = {
      type: 'arc-quadratic',
      point: leftCurve.end,
      controlPoint: leftCurve.controlPoint,
    };

    const rightArcSegment: QuadraticBezierSegment = {
      type: 'arc-quadratic',
      point: rightCurve.end,
      controlPoint: rightCurve.controlPoint,
    };

    const afterSegments = [
      ...polygon.points.slice(0, segmentIndex + 1),
      leftArcSegment,
      rightArcSegment,
      ...polygon.points.slice(segmentIndex + 2),
    ];

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return { ...p, points: afterSegments };
      }
      return p;
    });

    this.historyManager.recordPolygonInsertPoint(polygonId, segmentIndex, newPoint, beforeSegments, afterSegments);
    this.emit('polygonsChanged', this.polygons.slice());
  }

  /**
   * Inserts a new point segment at the specified position on a cubic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-cubic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnCubicEdge(polygonId: Id, segmentIndex: number, t: number, newPoint: SheetPosition): void {
    const polygon = this.polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.slice();

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];

    if (!pointSegment || !arcSegment || pointSegment.type !== 'point' || arcSegment.type !== 'arc-cubic') {
      return;
    }

    const curve = {
      start: pointSegment.point,
      controlPointA: arcSegment.controlPointA,
      controlPointB: arcSegment.controlPointB,
      end: arcSegment.point,
    };

    const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(curve, t);

    const leftArcSegment: CubicBezierSegment = {
      type: 'arc-cubic',
      point: leftCurve.end,
      controlPointA: leftCurve.controlPointA,
      controlPointB: leftCurve.controlPointB,
    };

    const rightArcSegment: CubicBezierSegment = {
      type: 'arc-cubic',
      point: rightCurve.end,
      controlPointA: rightCurve.controlPointA,
      controlPointB: rightCurve.controlPointB,
    };

    const afterSegments = [
      ...polygon.points.slice(0, segmentIndex + 1),
      leftArcSegment,
      rightArcSegment,
      ...polygon.points.slice(segmentIndex + 2),
    ];

    this.polygons = this.polygons.map(p => {
      if (p.id === polygonId) {
        return { ...p, points: afterSegments };
      }
      return p;
    });

    this.historyManager.recordPolygonInsertPoint(polygonId, segmentIndex, newPoint, beforeSegments, afterSegments);
    this.emit('polygonsChanged', this.polygons.slice());
  }

  setWorkingPolygon(updatesOrFn: WorkingPolygon | null | ((old: WorkingPolygon | null) => WorkingPolygon | null)): void {
    let after: WorkingPolygon | null;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(this.workingPolygon);
    } else {
      after = updatesOrFn;
    }

    this.workingPolygon = after;
    this.emit('workingPolygonChanged', after);
  }

  clearWorkingPolygon(): void {
    this.workingPolygon = null;
    this.emit('workingPolygonChanged', null);
  }

  /** Sets the fill color of a polygon. Does NOT record to history - use setPolygonFillColor for that.
    * Internal version used by HistoryManager. */
  setPolygonFillColorDirect(id: Id, color: number | null): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    this.updatePolygonDirect(id, { fillColor: color });
  }

  /** Sets the fill color of a polygon, recording the change to history. */
  setPolygonFillColor(id: Id, color: number | null): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    const beforeColor = polygon.fillColor;
    if (beforeColor === color) return;
    this.updatePolygonDirect(id, { fillColor: color });
    this.historyManager.recordPolygonFillColor(id, beforeColor, color);
  }

  /** Sets the openAtIndex of a polygon. Does NOT record to history - use setPolygonOpenAtIndex for that.
    * Internal version used by HistoryManager. Automatically bounds to valid range. */
  setPolygonOpenAtIndexDirect(id: Id, index: number): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    const boundedIndex = Math.max(0, Math.min(index, polygon.points.length - 1));
    if (polygon.openAtIndex === boundedIndex) return;
    this.updatePolygonDirect(id, { openAtIndex: boundedIndex });
  }

  /** Sets the openAtIndex of a polygon. Automatically bounds to valid range. */
  setPolygonOpenAtIndex(id: Id, index: number): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    const boundedIndex = Math.max(0, Math.min(index, polygon.points.length - 1));
    if (polygon.openAtIndex === boundedIndex) return;
    const beforeIndex = polygon.openAtIndex;
    this.updatePolygonDirect(id, { openAtIndex: boundedIndex });
    this.historyManager.recordPolygonOpenAtIndex(id, beforeIndex, boundedIndex);
  }

  /** Sets the render order of a polygon. Does NOT record to history - use setPolygonRenderOrder for that.
    * Internal version used by HistoryManager. */
  setPolygonRenderOrderDirect(id: Id, order: number): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    if (polygon.renderOrder === order) return;
    this.updatePolygonDirect(id, { renderOrder: order });
  }

  /** Sets the render order of a polygon, recording the change to history. */
  setPolygonRenderOrder(id: Id, order: number): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (!polygon) return;
    if (polygon.renderOrder === order) return;
    const beforeOrder = polygon.renderOrder;
    this.updatePolygonDirect(id, { renderOrder: order });
    this.historyManager.recordPolygonRenderOrder(id, beforeOrder, order);
  }

  /** Closes a polygon. Does NOT record to history - use closePolygon for that.
    * Internal version used by HistoryManager. */
  closePolygonDirect(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => {
      if (polygon.closed || polygon.points.length < 3) {
        return polygon;
      }

      const splitAt = polygon.points.length - (polygon.openAtIndex + 1);
      return {
        ...polygon,
        points: [
          ...polygon.points.slice(splitAt),
          ...polygon.points.slice(0, splitAt),
          // Add back in final "closing" point
          { type: 'point', point: polygon.points[splitAt].point },
        ],
        closed: true,
      };
    });
  }

  /** Closes a polygon, recording the change to history. */
  closePolygon(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => {
      if (polygon.closed || polygon.points.length < 3) {
        return polygon;
      }

      const splitAt = polygon.points.length - (polygon.openAtIndex + 1);
      return {
        ...polygon,
        points: [
          ...polygon.points.slice(splitAt),
          ...polygon.points.slice(0, splitAt),
          // Add back in final "closing" point
          { type: 'point', point: polygon.points[splitAt].point },
        ],
        closed: true,
      };
    });
    this.historyManager.recordPolygonClose(id, false, true);
  }

  /** Opens a polygon. Does NOT record to history - use openPolygon for that.
    * Internal version used by HistoryManager. */
  openPolygonDirect(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => {
      if (!polygon.closed || polygon.points.length < 3) {
        return polygon;
      }
      return {
        ...polygon,
        points: [
          ...polygon.points.slice(polygon.openAtIndex+1, -1 /* remove closed mode "duplicate" point */),
          ...polygon.points.slice(0, polygon.openAtIndex+1),
        ],
        closed: false,
      };
    });
  }

  /** Opens a polygon, recording the change to history. */
  openPolygon(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => {
      if (!polygon.closed || polygon.points.length < 3) {
        return polygon;
      }
      return {
        ...polygon,
        points: [
          ...polygon.points.slice(polygon.openAtIndex+1, -1 /* remove closed mode "duplicate" point */),
          ...polygon.points.slice(0, polygon.openAtIndex+1),
        ],
        closed: false,
      };
    });
    this.historyManager.recordPolygonClose(id, true, false);
  }

  /** Clears all polygons, recording each deletion to history. */
  clearAllPolygons(): void {
    for (const polygon of this.polygons) {
      this.historyManager.recordPolygonDelete(polygon);
    }
    this.polygons = [];
    this.emit('polygonsChanged', this.polygons.slice());
  }

  // ==================== RECTANGLE METHODS ====================

  /**
   * Adds a rectangle, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addRectangle(rectangle: Omit<Rectangle, 'id'>): Rectangle {
    const id = this.historyManager.generateStableId(ID_PREFIXES.rectangle);
    const fullRectangle: Rectangle = { ...rectangle, id };
    this.rectangles.push(fullRectangle);
    this.historyManager.recordRectangleInsert(fullRectangle);
    this.emit('rectanglesChanged', this.rectangles.slice());
    this.emit('rectangleAdded', fullRectangle);
    return fullRectangle;
  }

  /**
   * Internal version of addRectangle that uses an existing rectangle with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addRectangleDirect(rectangle: Rectangle): void {
    this.rectangles.push(rectangle);
    this.emit('rectanglesChanged', this.rectangles.slice());
    this.emit('rectangleAdded', rectangle);
  }

  getRectangleById(id: Id): Rectangle | null {
    return this.rectangles.find(r => r.id === id) ?? null;
  }

  /** Updates a rectangle by id. Does NOT record to history - use updateRectangle for that.
    * Internal version used by HistoryManager. */
  updateRectangleDirect(id: Id, updatesOrFn: Partial<Rectangle> | ((old: Rectangle) => Rectangle)): void {
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
    this.emit('rectanglesChanged', this.rectangles.slice());
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
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  /** Deletes a rectangle by id, recording the deletion to history. */
  deleteRectangle(id: Id): void {
    const rectangle = this.rectangles.find(r => r.id === id);
    if (rectangle) {
      this.rectangles = this.rectangles.filter(r => r.id !== id);
      this.historyManager.recordRectangleDelete(rectangle);
      this.emit('rectanglesChanged', this.rectangles.slice());
    }
  }

  /**
   * Internal version of deleteRectangle that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteRectangleDirect(id: Id): void {
    this.rectangles = this.rectangles.filter(r => r.id !== id);
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  setWorkingRectangle(wr: WorkingRectangle | null): void {
    this.workingRectangle = wr;
    this.emit('workingRectangleChanged', wr);
  }

  clearWorkingRectangle(): void {
    this.workingRectangle = null;
    this.emit('workingRectangleChanged', null);
  }

  /** Sets the fill color of a rectangle. Does NOT record to history - use setRectangleFillColor for that.
    * Internal version used by HistoryManager. */
  setRectangleFillColorDirect(id: Id, color: number | null): void {
    const index = this.rectangles.findIndex(r => r.id === id);
    if (index < 0) return;
    this.rectangles[index] = { ...this.rectangles[index], fillColor: color };
    this.emit('rectanglesChanged', this.rectangles.slice());
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
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  /** Sets the linkDimensions flag of a rectangle. Does NOT record to history - use setRectangleLinkDimensions for that.
    * Internal version used by HistoryManager. */
  setRectangleLinkDimensionsDirect(id: Id, link: boolean): void {
    const index = this.rectangles.findIndex(r => r.id === id);
    if (index < 0) return;
    this.rectangles[index] = { ...this.rectangles[index], linkDimensions: link };
    this.emit('rectanglesChanged', this.rectangles.slice());
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
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  /** Takes the passed rectangle, deletes it, and converts it to a polygon. Records as a single
    * atomic conversion operation. */
  convertRectangleToPolygon(rectangleId: Id): Polygon {
    const rectangle = this.getRectangleById(rectangleId);
    if (!rectangle) {
      throw new Error(`GeometryStore.convertRectangleToPolygon: Cannot find rectangle ${rectangleId}`);
    }
    const points = rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight);
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);
    const polygon: Polygon = {
      id,
      closed: true,
      points,
      fillColor: rectangle.fillColor,
      openAtIndex: 0,
      renderOrder: rectangle.renderOrder,
    };
    this.addPolygonDirect(polygon);
    this.deleteRectangleDirect(rectangleId);
    this.historyManager.recordRectangleToPolygon(rectangle, polygon);
    return polygon;
  }

  // ==================== ELLIPSE METHODS ====================

  /**
   * Adds an ellipse, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addEllipse(ellipse: Omit<Ellipse, 'id'>): Ellipse {
    const id = this.historyManager.generateStableId(ID_PREFIXES.ellipse);
    const fullEllipse: Ellipse = { ...ellipse, id };
    this.ellipses.push(fullEllipse);
    this.historyManager.recordEllipseInsert(fullEllipse);
    this.emit('ellipsesChanged', this.ellipses.slice());
    this.emit('ellipseAdded', fullEllipse);
    return fullEllipse;
  }

  /**
   * Internal version of addEllipse that uses an existing ellipse with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addEllipseDirect(ellipse: Ellipse): void {
    this.ellipses.push(ellipse);
    this.emit('ellipsesChanged', this.ellipses.slice());
    this.emit('ellipseAdded', ellipse);
  }

  getEllipseById(id: Id): Ellipse | null {
    return this.ellipses.find(e => e.id === id) ?? null;
  }

  /** Updates an ellipse by id. Does NOT record to history - use updateEllipse for that.
    * Internal version used by HistoryManager. */
  updateEllipseDirect(id: Id, updatesOrFn: Partial<Ellipse> | ((old: Ellipse) => Ellipse)): void {
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
    this.emit('ellipsesChanged', this.ellipses.slice());
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
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  /** Deletes an ellipse by id, recording the deletion to history. */
  deleteEllipse(id: Id): void {
    const ellipse = this.ellipses.find(e => e.id === id);
    if (ellipse) {
      this.ellipses = this.ellipses.filter(e => e.id !== id);
      this.historyManager.recordEllipseDelete(ellipse);
      this.emit('ellipsesChanged', this.ellipses.slice());
    }
  }

  /**
   * Internal version of deleteEllipse that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteEllipseDirect(id: Id): void {
    this.ellipses = this.ellipses.filter(e => e.id !== id);
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  setWorkingEllipse(we: WorkingEllipse | null): void {
    this.workingEllipse = we;
    this.emit('workingEllipseChanged', we);
  }

  clearWorkingEllipse(): void {
    this.workingEllipse = null;
    this.emit('workingEllipseChanged', null);
  }

  /** Takes the passed ellipse, deletes it, and converts it to a polygon. Records as a single
    * atomic conversion operation. */
  convertEllipseToPolygon(ellipseId: Id): Polygon {
    const ellipse = this.getEllipseById(ellipseId);
    if (!ellipse) {
      throw new Error(`GeometryStore.convertEllipseToPolygon: Cannot find ellipse ${ellipseId}`);
    }
    const points = ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY);
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);
    const polygon: Polygon = {
      id,
      closed: true,
      points,
      fillColor: ellipse.fillColor,
      openAtIndex: 0,
      renderOrder: ellipse.renderOrder,
    };
    this.addPolygonDirect(polygon);
    this.deleteEllipseDirect(ellipseId);
    this.historyManager.recordEllipseToPolygon(ellipse, polygon);
    return polygon;
  }

  /** Sets the fill color of an ellipse. Does NOT record to history - use setEllipseFillColor for that.
    * Internal version used by HistoryManager. */
  setEllipseFillColorDirect(id: Id, color: number | null): void {
    const index = this.ellipses.findIndex(e => e.id === id);
    if (index < 0) return;
    this.ellipses[index] = { ...this.ellipses[index], fillColor: color };
    this.emit('ellipsesChanged', this.ellipses.slice());
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
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  /** Sets the linkDimensions flag of an ellipse. Does NOT record to history - use setEllipseLinkDimensions for that.
    * Internal version used by HistoryManager. */
  setEllipseLinkDimensionsDirect(id: Id, link: boolean): void {
    const index = this.ellipses.findIndex(e => e.id === id);
    if (index < 0) return;
    this.ellipses[index] = { ...this.ellipses[index], linkDimensions: link };
    this.emit('ellipsesChanged', this.ellipses.slice());
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
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  /** Sets the render order of an ellipse. Does NOT record to history - use setEllipseRenderOrder for that.
    * Internal version used by HistoryManager. */
  setEllipseRenderOrderDirect(id: Id, order: number): void {
    const index = this.ellipses.findIndex(e => e.id === id);
    if (index < 0) return;
    if (this.ellipses[index].renderOrder === order) return;
    this.ellipses[index] = { ...this.ellipses[index], renderOrder: order };
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  /** Sets the render order of an ellipse, recording the change to history. */
  setEllipseRenderOrder(id: Id, order: number): void {
    const ellipse = this.ellipses.find(e => e.id === id);
    if (!ellipse) return;
    if (ellipse.renderOrder === order) return;
    const beforeOrder = ellipse.renderOrder;
    const index = this.ellipses.findIndex(e => e.id === id);
    this.ellipses[index] = { ...this.ellipses[index], renderOrder: order };
    this.historyManager.recordEllipseRenderOrder(id, beforeOrder, order);
    this.emit('ellipsesChanged', this.ellipses.slice());
  }

  /** Sets the render order of a rectangle. Does NOT record to history - use setRectangleRenderOrder for that.
    * Internal version used by HistoryManager. */
  setRectangleRenderOrderDirect(id: Id, order: number): void {
    const index = this.rectangles.findIndex(r => r.id === id);
    if (index < 0) return;
    if (this.rectangles[index].renderOrder === order) return;
    this.rectangles[index] = { ...this.rectangles[index], renderOrder: order };
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  /** Sets the render order of a rectangle, recording the change to history. */
  setRectangleRenderOrder(id: Id, order: number): void {
    const rectangle = this.rectangles.find(r => r.id === id);
    if (!rectangle) return;
    if (rectangle.renderOrder === order) return;
    const beforeOrder = rectangle.renderOrder;
    const index = this.rectangles.findIndex(r => r.id === id);
    this.rectangles[index] = { ...this.rectangles[index], renderOrder: order };
    this.historyManager.recordRectangleRenderOrder(id, beforeOrder, order);
    this.emit('rectanglesChanged', this.rectangles.slice());
  }

  /** Returns the maximum render order across all geometry, or 0 if no geometry exists. */
  getMaxRenderOrder(): number {
    let max = 0;
    for (const polygon of this.polygons) {
      if (polygon.renderOrder > max) {
        max = polygon.renderOrder;
      }
    }
    for (const rectangle of this.rectangles) {
      if (rectangle.renderOrder > max) {
        max = rectangle.renderOrder;
      }
    }
    for (const ellipse of this.ellipses) {
      if (ellipse.renderOrder > max) {
        max = ellipse.renderOrder;
      }
    }
    return max;
  }

  // ==================== PATHFINDING ====================

  /**
   * Generates a vertex key from a position for use as a Map key.
   * Rounds to 6 decimal places to handle floating-point precision.
   */
  private vertexKey(pos: SheetPosition): string {
    return `${pos.x.toFixed(6)},${pos.y.toFixed(6)}`;
  }
}
