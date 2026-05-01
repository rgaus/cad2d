import EventEmitter from 'eventemitter3';
import { HistoryManager } from '../history/HistoryManager';
import type { Id, Polygon, WorkingPolygon, Rectangle, WorkingRectangle, Ellipse, WorkingEllipse, PointSegment, PolygonSegment, QuadraticBezierSegment, CubicBezierSegment } from './types';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';
import { ellipseToPolygon, rectangleToPolygon, DeCasteljau, manhattanDistance, astar, distVec2 } from '../math';

/** Default color for newly created geometry. */
export const DEFAULT_COLOR = 0x8d8d8d;

/**
 * A vertex in the polygon web graph.
 * Represents a specific segment endpoint in a polygon at a given position.
 */
type VertexData = {
  /** The polygon containing this vertex. */
  polygonId: Id;
  /** The index of the segment in the polygon's points array. */
  segmentIndex: number;
  /** The position of this vertex in sheet coordinates. */
  position: SheetPosition;
};

/**
 * An edge in the polygon web graph.
 * Represents a traversable connection between two vertices.
 */
type WebEdge = {
  /** The vertex key at the other end of this edge. */
  vertexId: string;
  /** The polygon and segment this edge traverses through. */
  edgeData: { polygonId: Id; segmentIndex: number };
};

/**
 * A polygon web is a connected group of polygons that share vertices.
 * Maintains a graph structure for pathfinding between any two vertices.
 */
type PolygonWebEntry = {
  /** Unique identifier for this web. */
  id: Id;
  /** All polygons in this web. */
  polygonIds: Set<Id>;
  /** Map from vertex key (x,y) to all VertexData at that position (multiple polygons can share a vertex). */
  vertices: Map<string, Set<VertexData>>;
  /** Adjacency list: vertex key -> connected vertices and their edge data for pathfinding. */
  adjacencyList: Map<string, Array<WebEdge>>;
};

/** Maximum active paths to prevent combinatorial explosion in pathfinding. */
const MAX_ACTIVE_PATHS = 10000;

/** An active path in multi-source pathfinding. */
type ActivePath = {
  /** Segments traversed in this path, in order. */
  segments: Array<{ polygonId: Id; segmentIndex: number; segment: PolygonSegment }>;
  /** Total length of this path. */
  totalLength: number;
  /** Vertex keys visited in this path (for cycle detection). */
  visitedVertices: Set<string>;
  /** The current vertex key at the end of this path. */
  currentVertexKey: string;
};

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

  /**
   * Polygon webs - connectivity index for pathfinding between polygons.
   * Internal implementation detail, not exposed outside GeometryStore.
   */
  private polygonWebs: Array<PolygonWebEntry> = [];

  /**
   * Maps vertex key to web id. Used for O(1) lookup when merging webs.
   */
  private vertexToWeb: Map<string, Id> = new Map();

  constructor(historyManager: HistoryManager) {
    super();
    this.historyManager = historyManager;
  }

  // ==================== POLYGON WEB METHODS (internal) ====================

  /**
   * Generates a vertex key from a position for use as a Map key.
   * Rounds to 6 decimal places to handle floating-point precision.
   */
  private vertexKey(pos: SheetPosition): string {
    return `${pos.x.toFixed(6)},${pos.y.toFixed(6)}`;
  }

  /**
   * Creates a new web for a polygon, registering all its vertices and edges.
   */
  private createWebForPolygon(polygon: Polygon): PolygonWebEntry {
    const webId = polygon.id;
    const web: PolygonWebEntry = {
      id: webId,
      polygonIds: new Set([polygon.id]),
      vertices: new Map(),
      adjacencyList: new Map(),
    };

    // Register all vertex endpoints from the polygon
    for (let i = 0; i < polygon.points.length; i += 1) {
      const segment = polygon.points[i];
      const position = segment.point;
      const key = this.vertexKey(position);

      const vertexData: VertexData = {
        polygonId: polygon.id,
        segmentIndex: i,
        position,
      };

      let vertexSet = web.vertices.get(key);
      if (typeof vertexSet === 'undefined') {
        vertexSet = new Set();
        web.vertices.set(key, vertexSet);
      }
      vertexSet.add(vertexData);
      this.vertexToWeb.set(key, webId);

      // Create edges to adjacent vertices within the same polygon
      if (i > 0) {
        const prevPosition = polygon.points[i - 1].point;
        const prevKey = this.vertexKey(prevPosition);
        this.addEdgeToWeb(web, prevKey, key, polygon.id, i);
      }
    }

    // For closed polygons, add edge from last to first
    if (polygon.closed && polygon.points.length > 0) {
      const lastKey = this.vertexKey(polygon.points[polygon.points.length - 1].point);
      const firstKey = this.vertexKey(polygon.points[0].point);
      this.addEdgeToWeb(web, lastKey, firstKey, polygon.id, 0);
    }

    this.polygonWebs.push(web);
    return web;
  }

  /**
   * Adds an edge between two vertices in a web.
   */
  private addEdgeToWeb(web: PolygonWebEntry, fromKey: string, toKey: string, polygonId: Id, segmentIndex: number): void {
    let edges = web.adjacencyList.get(fromKey);
    if (typeof edges === 'undefined') {
      edges = [];
      web.adjacencyList.set(fromKey, edges);
    }

    // Check if edge already exists
    const exists = edges.some(e => e.vertexId === toKey && e.edgeData.polygonId === polygonId);
    if (!exists) {
      edges.push({ vertexId: toKey, edgeData: { polygonId, segmentIndex } });
    }

    // Also add reverse edge
    let reverseEdges = web.adjacencyList.get(toKey);
    if (typeof reverseEdges === 'undefined') {
      reverseEdges = [];
      web.adjacencyList.set(toKey, reverseEdges);
    }
    const reverseExists = reverseEdges.some(e => e.vertexId === fromKey && e.edgeData.polygonId === polygonId);
    if (!reverseExists) {
      reverseEdges.push({ vertexId: fromKey, edgeData: { polygonId, segmentIndex: segmentIndex - 1 < 0 ? 0 : segmentIndex - 1 } });
    }
  }

  /**
   * Registers a polygon in the web system.
   * Creates a new web if it's isolated, or joins existing webs if it shares vertices.
   */
  private registerPolygonInWeb(polygon: Polygon): void {
    // First, find all existing vertices in this polygon that have matches in other polygons
    const existingMatches: Array<{ vertexKey: string; vertexData: VertexData }> = [];

    for (let i = 0; i < polygon.points.length; i += 1) {
      const position = polygon.points[i].point;
      const key = this.vertexKey(position);
      const existingWebId = this.vertexToWeb.get(key);

      if (typeof existingWebId !== 'undefined') {
        // Find the vertex data in the existing web
        const existingWeb = this.polygonWebs.find(w => w.id === existingWebId);
        if (existingWeb) {
          const vertexSet = existingWeb.vertices.get(key);
          if (vertexSet) {
            for (const vd of vertexSet) {
              if (vd.polygonId !== polygon.id) {
                existingMatches.push({ vertexKey: key, vertexData: vd });
              }
            }
          }
        }
      }
    }

    if (existingMatches.length === 0) {
      // No matching vertices - create a new isolated web
      this.createWebForPolygon(polygon);
      return;
    }

    // Find the web with the most vertices to use as the target
    let targetWeb: PolygonWebEntry | null = null;
    const matchedWebIds = new Set<Id>();

    for (const match of existingMatches) {
      const webId = this.vertexToWeb.get(match.vertexKey);
      if (typeof webId !== 'undefined') {
        matchedWebIds.add(webId);
      }
    }

    if (matchedWebIds.size === 0) {
      this.createWebForPolygon(polygon);
      return;
    }

    // Find the largest web among matches
    let maxVertices = 0;
    for (const webId of matchedWebIds) {
      const web = this.polygonWebs.find(w => w.id === webId);
      if (web && web.vertices.size > maxVertices) {
        maxVertices = web.vertices.size;
        targetWeb = web;
      }
    }

    if (targetWeb === null) {
      this.createWebForPolygon(polygon);
      return;
    }

    // Add this polygon to the target web
    targetWeb.polygonIds.add(polygon.id);

    // Register all vertices and edges
    for (let i = 0; i < polygon.points.length; i += 1) {
      const segment = polygon.points[i];
      const position = segment.point;
      const key = this.vertexKey(position);

      const vertexData: VertexData = {
        polygonId: polygon.id,
        segmentIndex: i,
        position,
      };

      let vertexSet = targetWeb.vertices.get(key);
      if (typeof vertexSet === 'undefined') {
        vertexSet = new Set();
        targetWeb.vertices.set(key, vertexSet);
      }
      vertexSet.add(vertexData);
      this.vertexToWeb.set(key, targetWeb.id);

      // Add edges to adjacent vertices
      if (i > 0) {
        const prevKey = this.vertexKey(polygon.points[i - 1].point);
        this.addEdgeToWeb(targetWeb, prevKey, key, polygon.id, i);
      }
    }

    // For closed polygons, add edge from last to first
    if (polygon.closed && polygon.points.length > 0) {
      const lastKey = this.vertexKey(polygon.points[polygon.points.length - 1].point);
      const firstKey = this.vertexKey(polygon.points[0].point);
      this.addEdgeToWeb(targetWeb, lastKey, firstKey, polygon.id, 0);
    }

    // Merge any other webs that share vertices with this polygon
    for (const match of existingMatches) {
      const otherWebId = this.vertexToWeb.get(match.vertexKey);
      if (typeof otherWebId !== 'undefined' && otherWebId !== targetWeb.id) {
        this.mergeWebs(targetWeb.id, otherWebId);
      }
    }
  }

  /**
   * Merges two webs together. The source web is merged into the target.
   */
  private mergeWebs(targetWebId: Id, sourceWebId: Id): void {
    if (targetWebId === sourceWebId) {
      return;
    }

    const targetIndex = this.polygonWebs.findIndex(w => w.id === targetWebId);
    const sourceIndex = this.polygonWebs.findIndex(w => w.id === sourceWebId);

    if (targetIndex < 0 || sourceIndex < 0) {
      return;
    }

    const targetWeb = this.polygonWebs[targetIndex];
    const sourceWeb = this.polygonWebs[sourceIndex];

    // Transfer all polygon IDs
    for (const pid of sourceWeb.polygonIds) {
      targetWeb.polygonIds.add(pid);
    }

    // Transfer all vertices and update vertexToWeb mapping
    for (const [key, vertexSet] of sourceWeb.vertices) {
      let targetSet = targetWeb.vertices.get(key);
      if (typeof targetSet === 'undefined') {
        targetSet = new Set();
        targetWeb.vertices.set(key, targetSet);
      }
      for (const vd of vertexSet) {
        targetSet.add(vd);
      }
      this.vertexToWeb.set(key, targetWebId);
    }

    // Merge adjacency lists
    for (const [key, edges] of sourceWeb.adjacencyList) {
      let targetEdges = targetWeb.adjacencyList.get(key);
      if (typeof targetEdges === 'undefined') {
        targetEdges = [];
        targetWeb.adjacencyList.set(key, targetEdges);
      }
      for (const edge of edges) {
        const exists = targetEdges.some(e => e.vertexId === edge.vertexId && e.edgeData.polygonId === edge.edgeData.polygonId);
        if (!exists) {
          targetEdges.push(edge);
        }
      }
    }

    // Remove the source web
    this.polygonWebs.splice(sourceIndex, 1);
  }

  /**
   * Unregisters a polygon from the web system.
   * Cleans up any orphaned vertices.
   */
  private unregisterPolygonFromWeb(polygonId: Id): void {
    for (const web of this.polygonWebs) {
      if (web.polygonIds.has(polygonId)) {
        web.polygonIds.delete(polygonId);

        // Remove all vertices belonging to this polygon
        const keysToRemove: Array<string> = [];
        for (const [key, vertexSet] of web.vertices) {
          const toRemove: Array<VertexData> = [];
          for (const vd of vertexSet) {
            if (vd.polygonId === polygonId) {
              toRemove.push(vd);
            }
          }
          for (const vd of toRemove) {
            vertexSet.delete(vd);
          }
          if (vertexSet.size === 0) {
            keysToRemove.push(key);
          }
        }

        // Clean up empty vertex entries
        for (const key of keysToRemove) {
          web.vertices.delete(key);
          this.vertexToWeb.delete(key);
          web.adjacencyList.delete(key);
        }

        // Also clean up edges pointing to removed vertices
        for (const [key, edges] of web.adjacencyList) {
          const filtered = edges.filter(e => {
            const targetVertices = web.vertices.get(e.vertexId);
            return typeof targetVertices !== 'undefined' && targetVertices.size > 0;
          });
          if (filtered.length === 0) {
            web.adjacencyList.delete(key);
          } else {
            web.adjacencyList.set(key, filtered);
          }
        }

        break;
      }
    }

    // Remove any webs that have no polygons left
    this.polygonWebs = this.polygonWebs.filter(w => w.polygonIds.size > 0);
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

    this.registerPolygonInWeb(fullPolygon);

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

    this.registerPolygonInWeb(polygon);

    this.emit('polygonsChanged', this.polygons);
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

      this.unregisterPolygonFromWeb(id);

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

    this.unregisterPolygonFromWeb(id);

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
   * Finds the shortest path from a starting vertex to any vertex that satisfies the isComplete callback.
   * Uses multi-source expansion with cycle detection and culling for performance.
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
    // Find the start polygon and segment
    const startPolygon = this.polygons.find(p => p.id === startPolygonId);
    if (!startPolygon) {
      return null;
    }

    const startSegment = startPolygon.points[startSegmentIndex];
    if (!startSegment) {
      return null;
    }

    const startKey = this.vertexKey(startSegment.point);
    const startWebId = this.vertexToWeb.get(startKey);
    if (!startWebId) {
      return null;
    }

    const web = this.polygonWebs.find(w => w.id === startWebId);
    if (!web) {
      return null;
    }

    // Get the start position for length calculations
    const startPos = startSegment.point;

    // Helper to get the position of a vertex by key
    const getPositionForKey = (key: string): SheetPosition | null => {
      const vertices = web.vertices.get(key);
      if (!vertices || vertices.size === 0) {
        return null;
      }
      const anyVd = vertices.values().next().value;
      return anyVd ? anyVd.position : null;
    };

    // Helper to calculate segment length (chord length for now, TODO: arc length for bezier curves)
    const getSegmentLength = (prevPos: SheetPosition, segment: PolygonSegment): number => {
      return distVec2(prevPos, segment.point);
    };

    // Helper to check if start vertex itself satisfies isComplete
    const startVertices = web.vertices.get(startKey);
    if (startVertices) {
      for (const vd of startVertices) {
        if (isComplete(vd.polygonId, vd.segmentIndex, vd.position)) {
          return [];  // Empty path - we're already at destination
        }
      }
    }

    // Initialize active paths from all edges from the start vertex
    const edgesFromStart = web.adjacencyList.get(startKey) || [];
    const activePaths: ActivePath[] = [];
    let shortestCompletePathLength = Infinity;
    const completePaths: ActivePath[] = [];

    for (const edge of edgesFromStart) {
      // Get the segment for this edge
      const polygon = this.polygons.find(p => p.id === edge.edgeData.polygonId);
      if (!polygon) {
        continue;
      }
      const segment = polygon.points[edge.edgeData.segmentIndex];
      if (!segment) {
        continue;
      }

      // Get the position at the other end of this segment
      const otherPos = getPositionForKey(edge.vertexId);
      if (!otherPos) {
        continue;
      }

      const newPath: ActivePath = {
        segments: [{
          polygonId: edge.edgeData.polygonId,
          segmentIndex: edge.edgeData.segmentIndex,
          segment,
        }],
        totalLength: getSegmentLength(startPos, segment),
        visitedVertices: new Set([startKey]),
        currentVertexKey: edge.vertexId,
      };

      // Check if this path is complete
      const edgeVertices = web.vertices.get(edge.vertexId);
      if (edgeVertices) {
        for (const vd of edgeVertices) {
          if (isComplete(vd.polygonId, vd.segmentIndex, vd.position)) {
            completePaths.push(newPath);
            if (newPath.totalLength < shortestCompletePathLength) {
              shortestCompletePathLength = newPath.totalLength;
            }
            break;
          }
        }
      }

      // Add to active paths if not complete
      if (completePaths.length === 0 || newPath.totalLength >= shortestCompletePathLength) {
        activePaths.push(newPath);
      }
    }

    // Expand loop - continue while we have active paths shorter than the shortest complete path
    while (activePaths.length > 0) {
      // Sort by totalLength to expand shortest paths first (Dijkstra-style)
      activePaths.sort((a, b) => a.totalLength - b.totalLength);

      // If shortest active path is already longer than a complete path, we're done
      if (activePaths[0].totalLength >= shortestCompletePathLength) {
        break;
      }

      // Pop the shortest active path
      const currentPath = activePaths.shift()!;

      // Safety check for MAX_ACTIVE_PATHS
      if (activePaths.length > MAX_ACTIVE_PATHS) {
        return null;
      }

      // Get edges from current vertex
      const currentEdges = web.adjacencyList.get(currentPath.currentVertexKey) || [];

      for (const edge of currentEdges) {
        // Skip if we've already visited this vertex in this path
        if (currentPath.visitedVertices.has(edge.vertexId)) {
          continue;
        }

        // Get the segment for this edge
        const polygon = this.polygons.find(p => p.id === edge.edgeData.polygonId);
        if (!polygon) {
          continue;
        }
        const segment = polygon.points[edge.edgeData.segmentIndex];
        if (!segment) {
          continue;
        }

        // Get the position at the other end of this segment
        const otherPos = getPositionForKey(edge.vertexId);
        if (!otherPos) {
          continue;
        }

        // Calculate new path length
        const prevPos = getPositionForKey(currentPath.currentVertexKey);
        if (!prevPos) {
          continue;
        }
        const newLength = currentPath.totalLength + getSegmentLength(prevPos, segment);

        // Culling: if longer than shortest complete path, skip
        if (newLength >= shortestCompletePathLength) {
          continue;
        }

        // Create new path
        const newPath: ActivePath = {
          segments: [...currentPath.segments, {
            polygonId: edge.edgeData.polygonId,
            segmentIndex: edge.edgeData.segmentIndex,
            segment,
          }],
          totalLength: newLength,
          visitedVertices: new Set([...currentPath.visitedVertices, edge.vertexId]),
          currentVertexKey: edge.vertexId,
        };

        // Check if this path is complete
        const edgeVertices = web.vertices.get(edge.vertexId);
        if (edgeVertices) {
          for (const vd of edgeVertices) {
            if (isComplete(vd.polygonId, vd.segmentIndex, vd.position)) {
              completePaths.push(newPath);
              if (newLength < shortestCompletePathLength) {
                shortestCompletePathLength = newLength;
              }
              break;
            }
          }
        }

        // Add to active paths if not complete and shorter than shortest complete path
        if (newLength < shortestCompletePathLength) {
          activePaths.push(newPath);
        }
      }

      // Safety check after adding
      if (activePaths.length > MAX_ACTIVE_PATHS) {
        return null;
      }
    }

    // Return the shortest complete path
    if (completePaths.length === 0) {
      return null;
    }

    // Find and return the shortest complete path
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
