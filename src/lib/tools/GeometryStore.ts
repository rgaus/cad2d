import EventEmitter from 'eventemitter3';
import { HistoryManager } from '../history/HistoryManager';
import type { Id, Polygon, WorkingPolygon, Rectangle, WorkingRectangle, Ellipse, WorkingEllipse, PointSegment, PolygonSegment, QuadraticBezierSegment, CubicBezierSegment } from './types';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';
import { ellipseToPolygon, rectangleToPolygon, DeCasteljau, manhattanDistance, astar, distVec2 } from '../math';

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

  getPolygonById(id: Id): olygon | null {
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
    this.emit('polygonsChanged', this.polygons);
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
    this.emit('polygonsChanged', this.polygons);
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

  /** Clears all polygons, recording each deletion to history. */
  clearAllPolygons(): void {
    for (const polygon of this.polygons) {
      this.historyManager.recordPolygonDelete(polygon);
    }
    this.polygons = [];
    this.emit('polygonsChanged', this.polygons);
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

  /** Takes the passed rectangle, deletes it, and converts it to a polygon, returning the given new
    * polygon id. */
  convertRectangleToPolygon(rectangleId: Id): Polygon {
    const rectangle = this.getRectangleById(rectangleId);
    if (!rectangle) {
      throw new Error(`GeometryStore.convertRectangleToPolygon: Cannot find rectangle ${rectangleId}`);
    }
    this.deleteRectangle(rectangleId);
    const points = rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight);

    return this.addPolygon({
      closed: true,
      points,
      fillColor: rectangle.fillColor,
    });
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

  /** Takes the passed ellipse, deletes it, and converts it to a polygon, returning the given new
    * polygon id. */
  convertEllipseToPolygon(ellipseId: Id): Polygon {
    const ellipse = this.getEllipseById(ellipseId);
    if (!ellipse) {
      throw new Error(`GeometryStore.convertEllipseToPolygon: Cannot find ellipse ${ellipseId}`);
    }
    this.deleteEllipse(ellipseId);
    const points = ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY);

    return this.addPolygon({
      closed: true,
      points,
      fillColor: ellipse.fillColor,
    });
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

  // ==================== PATHFINDING ====================

  /**
   * Generates a vertex key from a position for use as a Map key.
   * Rounds to 6 decimal places to handle floating-point precision.
   */
  private vertexKey(pos: SheetPosition): string {
    return `${pos.x.toFixed(6)},${pos.y.toFixed(6)}`;
  }

  /**
   * Finds the shortest path from a starting vertex to any vertex that satisfies the isComplete callback.
   * Builds connectivity graph on-the-fly by scanning all polygons for matching vertices.
   *
   * @param startPolygonId - The id of the starting polygon.
   * @param startSegmentIndex - The segment index in the starting polygon (the start vertex is this segment's endpoint).
   * @param isComplete - Callback that returns true when a path reaches its destination. Called as (polygonId, segmentIndex, position).
   * @returns Array of path segments in order, or null if no path exists.
   */
  findShortestPath(
    startPolygonId: Id,
    startSegmentIndex: number,
    isComplete: (polygonId: Id, segmentIndex: number, position: SheetPosition) => boolean,
  ): Array<{ polygonId: Id; segmentIndex: number; segment: PolygonSegment }> | null {
    const startPolygon = this.polygons.find(p => p.id === startPolygonId);
    if (!startPolygon) {
      return null;
    }

    const startSegment = startPolygon.points[startSegmentIndex];
    if (!startSegment) {
      return null;
    }
    // console.log('A');

    const startKey = this.vertexKey(startSegment.point);

    type VertexEntry = { polygonId: Id; segmentIndex: number; position: SheetPosition };
    const vertexMap: Map<string, Array<VertexEntry>> = new Map();

    for (const polygon of this.polygons) {
      for (let i = 0; i < polygon.points.length; i += 1) {
        const seg = polygon.points[i];
        const key = this.vertexKey(seg.point);
        const entry: VertexEntry = { polygonId: polygon.id, segmentIndex: i, position: seg.point };

        let entries = vertexMap.get(key);
        if (typeof entries === 'undefined') {
          entries = [];
          vertexMap.set(key, entries);
        }
        entries.push(entry);
      }
    }

    type PathEdge = { polygonId: Id; segmentIndex: number; targetKey: string };
    const adjacencyList: Map<string, Array<PathEdge>> = new Map();

    const addEdge = (fromKey: string, toKey: string, polygonId: Id, segmentIndex: number) => {
      if (fromKey === toKey) {
        return;
      }
      let edges = adjacencyList.get(fromKey);
      if (typeof edges === 'undefined') {
        edges = [];
        adjacencyList.set(fromKey, edges);
      }
      const exists = edges.some(e => e.targetKey === toKey && e.polygonId === polygonId);
      if (!exists) {
        edges.push({ polygonId, segmentIndex, targetKey: toKey });
      }
    };

    const getSegmentLength = (prevPos: SheetPosition, segment: PolygonSegment): number => {
      return distVec2(prevPos, segment.point);
    };

    for (const polygon of this.polygons) {
      if (polygon.points.length === 0) {
        continue;
      }
      for (let i = 0; i < polygon.points.length; i += 1) {
        const seg = polygon.points[i];
        const key = this.vertexKey(seg.point);

        if (i > 0) {
          const prevSeg = polygon.points[i - 1];
          const prevKey = this.vertexKey(prevSeg.point);
          addEdge(prevKey, key, polygon.id, i);
        }

        if (polygon.closed && i === polygon.points.length - 1) {
          const firstSeg = polygon.points[0];
          const firstKey = this.vertexKey(firstSeg.point);
          addEdge(key, firstKey, polygon.id, 0);
        }
      }
    }

    for (const entries of vertexMap.values()) {
      if (entries.length < 2) {
        continue;
      }
      // console.log('[findShortestPath] Vertex at', entries[0].position.x, entries[0].position.y, 'has', entries.length, 'entries');
      
      for (const entryA of entries) {
        const polygonA = this.polygons.find(p => p.id === entryA.polygonId);
        if (!polygonA) {
          continue;
        }
        
        const segIdxA = entryA.segmentIndex;
        const prevSegIdxA = segIdxA === 0 ? polygonA.points.length - 1 : segIdxA - 1;
        
        if (prevSegIdxA >= polygonA.points.length) {
          continue;
        }
        
        const predecessorA = polygonA.points[prevSegIdxA].point;
        const predecessorKeyA = this.vertexKey(predecessorA);
        
        for (const entryB of entries) {
          if (entryA === entryB) {
            continue;
          }
          
          const polygonB = this.polygons.find(p => p.id === entryB.polygonId);
          if (!polygonB) {
            continue;
          }
          
          const segIdxB = entryB.segmentIndex;
          const prevSegIdxB = segIdxB === 0 ? polygonB.points.length - 1 : segIdxB - 1;
          
          if (prevSegIdxB >= polygonB.points.length) {
            continue;
          }
          
          const predecessorB = polygonB.points[prevSegIdxB].point;
          const predecessorKeyB = this.vertexKey(predecessorB);
          
          // console.log('[findShortestPath]   Cross-polygon: from', this.vertexKey(entryA.position), 'via polygonB seg', prevSegIdxB, '->', predecessorKeyB);
          
          addEdge(this.vertexKey(entryA.position), predecessorKeyB, polygonB.id, prevSegIdxB);
          addEdge(this.vertexKey(entryB.position), predecessorKeyA, polygonA.id, prevSegIdxA);
        }
      }
    }

    // console.log('B');
    const startVertices = vertexMap.get(startKey);
    if (startVertices) {
      for (const vd of startVertices) {
        if (isComplete(vd.polygonId, vd.segmentIndex, vd.position)) {
          return [];
        }
      }
    }

    const edgesFromStart = adjacencyList.get(startKey) || [];
    type ActivePath = {
      segments: Array<{ polygonId: Id; segmentIndex: number; segment: PolygonSegment }>;
      totalLength: number;
      visitedVertices: Set<string>;
      currentVertexKey: string;
    };
    const activePaths: ActivePath[] = [];
    let shortestCompletePathLength = Infinity;
    const completePaths: ActivePath[] = [];

    for (const edge of edgesFromStart) {
      const polygon = this.polygons.find(p => p.id === edge.polygonId);
      if (!polygon) {
        continue;
      }
      const segment = polygon.points[edge.segmentIndex];
      if (!segment) {
        continue;
      }

      const newPath: ActivePath = {
        segments: [{
          polygonId: edge.polygonId,
          segmentIndex: edge.segmentIndex,
          segment,
        }],
        totalLength: getSegmentLength(startSegment.point, segment),
        visitedVertices: new Set([startKey]),
        currentVertexKey: edge.targetKey,
      };

      const isCompleteForEdge = isComplete(edge.polygonId, edge.segmentIndex, segment.point);
      if (isCompleteForEdge) {
        completePaths.push(newPath);
        if (newPath.totalLength < shortestCompletePathLength) {
          shortestCompletePathLength = newPath.totalLength;
        }
      }

      if (completePaths.length === 0 || newPath.totalLength >= shortestCompletePathLength) {
        activePaths.push(newPath);
      }
    }

    // console.log('ACTIVE START', activePaths.slice());

    // console.log('[findShortestPath] ======== DEBUG ========');
    // console.log('[findShortestPath] startKey:', startKey);
    // console.log('[findShortestPath] startSegment.point:', startSegment.point.x, startSegment.point.y);
    // console.log('[findShortestPath] adjacencyList entries:');
    for (const [key, edges] of adjacencyList) {
      console.log('  ', key, '->', JSON.stringify(edges.map(e => ({polygonId: e.polygonId, segIdx: e.segmentIndex, targetKey: e.targetKey}))));
    }

    while (activePaths.length > 0) {
      activePaths.sort((a, b) => a.totalLength - b.totalLength);

      if (activePaths[0].totalLength >= shortestCompletePathLength) {
        break;
      }

      const currentPath = activePaths.shift()!;
      // console.log('[findShortestPath] Expanding path from vertex:', currentPath.currentVertexKey, 'segments:', currentPath.segments.length);

      const currentEdges = adjacencyList.get(currentPath.currentVertexKey) || [];
      // console.log('[findShortestPath] Edges from', currentPath.currentVertexKey, ':', JSON.stringify(currentEdges.map(e => ({polygonId: e.polygonId, segIdx: e.segmentIndex, targetKey: e.targetKey}))));

      for (const edge of currentEdges) {
        if (currentPath.visitedVertices.has(edge.targetKey)) {
          // console.log('[findShortestPath]   Skipping edge to', edge.targetKey, '- already visited');
          continue;
        }

        const polygon = this.polygons.find(p => p.id === edge.polygonId);
        if (!polygon) {
          // console.log('[findShortestPath]   Polygon not found for', edge.polygonId);
          continue;
        }
        const segment = polygon.points[edge.segmentIndex];
        if (!segment) {
          // console.log('[findShortestPath]   Segment not found at idx', edge.segmentIndex);
          continue;
        }

        const currentVertices = vertexMap.get(currentPath.currentVertexKey);
        if (!currentVertices || currentVertices.length === 0) {
          // console.log('[findShortestPath]   No vertices at', currentPath.currentVertexKey);
          continue;
        }
        const currentPos = currentVertices[0].position;

        const newLength = currentPath.totalLength + getSegmentLength(currentPos, segment);

        if (newLength >= shortestCompletePathLength) {
          // console.log('[findShortestPath]   newLength', newLength, '>= shortestCompletePathLength', shortestCompletePathLength);
          continue;
        }

        const newPath: ActivePath = {
          segments: [...currentPath.segments, {
            polygonId: edge.polygonId,
            segmentIndex: edge.segmentIndex,
            segment,
          }],
          totalLength: newLength,
          visitedVertices: new Set([...currentPath.visitedVertices, edge.targetKey]),
          currentVertexKey: edge.targetKey,
        };

        const trimSegmentEndPos = { x: 2.333333333333333, y: 6 };
        const pos = segment.point;
        // console.log('[findShortestPath]     segment type:', segment.type, 'point:', pos);
        // console.log('[findShortestPath]     pos.x type:', typeof pos.x, 'value:', pos.x);
        // console.log('[findShortestPath]     pos.y type:', typeof pos.y, 'value:', pos.y);
        // console.log('[findShortestPath]     trimSegmentEndPos.x type:', typeof trimSegmentEndPos.x, 'value:', trimSegmentEndPos.x);
        // console.log('[findShortestPath]     trimSegmentEndPos.y type:', typeof trimSegmentEndPos.y, 'value:', trimSegmentEndPos.y);
        
        const isCompleteResult = isComplete(edge.polygonId, edge.segmentIndex, segment.point);
        // console.log('[findShortestPath]     isComplete called with polygonId:', edge.polygonId, 'segmentIndex:', edge.segmentIndex, 'pos.x:', segment.point.x, 'pos.y:', segment.point.y);
        // console.log('[findShortestPath]     isComplete returned:', isCompleteResult);
        
        const xDiffDebug = Math.abs(segment.point.x - trimSegmentEndPos.x);
        const yDiffDebug = Math.abs(segment.point.y - trimSegmentEndPos.y);
        // console.log('[findShortestPath]     x diff:', xDiffDebug, 'y diff:', yDiffDebug, 'threshold: 0.0001');
        
        const isCompleteForEdge = isCompleteResult;
        // console.log('[findShortestPath]   Checking isComplete for', edge.polygonId, 'seg', edge.segmentIndex, 'pos', segment.point.x, segment.point.y, '=>', isCompleteForEdge);
        if (isCompleteForEdge) {
          completePaths.push(newPath);
          if (newLength < shortestCompletePathLength) {
            shortestCompletePathLength = newLength;
          }
        }

        if (newLength < shortestCompletePathLength) {
          activePaths.push(newPath);
        }
      }
    }

    // console.log('[findShortestPath] Final: activePaths:', activePaths.length, 'completePaths:', completePaths.length);
    // console.log('[findShortestPath] ======== END DEBUG ========');

    if (completePaths.length === 0) {
      return null;
    }

    let bestPath: ActivePath | null = null;
    let bestLength = Infinity;
    for (const path of completePaths) {
      if (path.totalLength < bestLength) {
        bestLength = path.totalLength;
        bestPath = path;
      }
    }

    return bestPath ? bestPath.segments : null;
  }
}
