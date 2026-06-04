import EventEmitter from 'eventemitter3';
import debounce from 'lodash.debounce';
import {
  CONSTRAINT_SOLVER_MAX_ITERATIONS,
  generatePositionsKeyOrder,
  getLoss,
  gradientDescent,
  isInConflict,
  positionsToState,
  stateToPositions,
} from '@/lib/constraint-engine';
import { DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import {
  type Constraint,
  ConstraintEndpoint,
  ConstraintTemplate,
} from '@/lib/geometry/constraints';
import { Ellipse, type EllipseTemplate } from '@/lib/geometry/ellipse';
import {
  type CubicBezierSegment,
  type PointSegment,
  Polygon,
  type PolygonSegment,
  type PolygonTemplate,
  type QuadraticBezierSegment,
} from '@/lib/geometry/polygon';
import { Rectangle, type RectangleTemplate } from '@/lib/geometry/rectangle';
import {
  EllipseComponent,
  FillColorComponent,
  Geometry,
  type Id,
  LinkDimensionsComponent,
  PolygonComponent,
  RectangleComponent,
  RenderOrderComponent,
  isEllipse,
  isPolygon,
  isRectangle,
} from '@/lib/geometry/types';
import {
  WorkingConstraint,
  type WorkingEllipse,
  type WorkingPolygon,
  type WorkingRectangle,
} from '@/lib/tools/types';
import { VertexId } from '../dcel';
import { HistoryManager } from '../history/HistoryManager';
import { UndoEntry } from '../history/types';
import {
  DeCasteljau,
  ellipsePoints,
  ellipseToPolygon,
  geometryBoundingBox,
  rectCorners,
  rectangleToPolygon,
} from '../math';
import { UnitType } from '../units/length';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';

export const ID_PREFIXES = {
  polygon: 'ply' as const,
  rectangle: 'rct' as const,
  ellipse: 'elp' as const,
  constraint: 'cns' as const,
};

/** Events emitted by GeometryStore. */
export type GeometryStoreEvents = {
  geometryAdded: (geometry: Geometry) => void;
  geometryUpdated: (geometry: Geometry) => void;
  geometryDeleted: (geometryId: Geometry["id"]) => void;
  polygonAdded: (polygon: Polygon) => void;
  polygonsChanged: (polygons: Array<Polygon>) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
  rectangleAdded: (rectangle: Rectangle) => void;
  rectanglesChanged: (rectangles: Array<Rectangle>) => void;
  workingRectangleChanged: (wr: WorkingRectangle | null) => void;
  ellipseAdded: (ellipse: Ellipse) => void;
  ellipsesChanged: (ellipses: Array<Ellipse>) => void;
  workingEllipseChanged: (we: WorkingEllipse | null) => void;
  constraintAdded: (constraint: Constraint) => void;
  constraintsChanged: (constraints: Array<Constraint>) => void;
  workingConstraintsChanged: (we: Array<WorkingConstraint>) => void;
};

/**
 * Stores all completed geometry (polygons, rectangles, ellipses) and the currently-drawn working shapes.
 * All mutating operations are recorded to the HistoryManager for undo/redo.
 */
export class GeometryStore extends EventEmitter<GeometryStoreEvents> {
  private geometryById = new Map<Id, Geometry>();

  get polygons(): Array<Polygon> {
    return Array.from(this.geometryById.values()).filter(isPolygon);
  }

  get rectangles(): Array<Rectangle> {
    return Array.from(this.geometryById.values()).filter(isRectangle);
  }

  get ellipses(): Array<Ellipse> {
    return Array.from(this.geometryById.values()).filter(isEllipse);
  }

  constraints: Array<Constraint> = [];

  workingPolygon: WorkingPolygon | null = null;
  workingRectangle: WorkingRectangle | null = null;
  workingEllipse: WorkingEllipse | null = null;
  workingConstraints: Array<WorkingConstraint> = [];

  dcelIndex = new DCELShapeIndex();

  /**
   * Per-shape-ID debounced DCEL index updaters.  During rapid geometry
   * changes (e.g. dragging a shape) each shape's DCEL update is deferred
   * until 200 ms after its last mutation, keeping the hot path fast while
   * maintaining eventual consistency.
   */
  private _debouncedPolygonUpdaters = new Map<Id, ReturnType<typeof debounce>>();
  private _debouncedRectangleUpdaters = new Map<Id, ReturnType<typeof debounce>>();
  private _debouncedEllipseUpdaters = new Map<Id, ReturnType<typeof debounce>>();
  private syncPolygonUpdateToDecl(id: Id, polygon: Polygon, immediate?: boolean): void {
    if (immediate) {
      this.dcelIndex.updatePolygon(polygon);
      this._debouncedPolygonUpdaters.delete(id);
      return;
    }

    let updater = this._debouncedPolygonUpdaters.get(id);
    if (typeof updater === 'undefined') {
      updater = debounce((p: Polygon) => {
        this.dcelIndex.updatePolygon(p);
        this._debouncedPolygonUpdaters.delete(id);
      }, 200);
      this._debouncedPolygonUpdaters.set(id, updater);
    }
    updater(polygon);
  }

  private syncRectangleUpdateToDecl(id: Id, rect: Rectangle, immediate?: boolean): void {
    if (immediate) {
      this.dcelIndex.updateRectangle(rect);
      this._debouncedRectangleUpdaters.delete(id);
      return;
    }

    let updater = this._debouncedRectangleUpdaters.get(id);
    if (typeof updater === 'undefined') {
      updater = debounce((r: Rectangle) => {
        this.dcelIndex.updateRectangle(r);
        this._debouncedRectangleUpdaters.delete(id);
      }, 200);
      this._debouncedRectangleUpdaters.set(id, updater);
    }
    updater(rect);
  }

  private syncEllipseUpdateToDcel(id: Id, ellipse: Ellipse, immediate?: boolean): void {
    if (immediate) {
      this.dcelIndex.updateEllipse(ellipse);
      this._debouncedEllipseUpdaters.delete(id);
      return;
    }

    let updater = this._debouncedEllipseUpdaters.get(id);
    if (typeof updater === 'undefined') {
      updater = debounce((e: Ellipse) => {
        this.dcelIndex.updateEllipse(e);
        this._debouncedEllipseUpdaters.delete(id);
      }, 200);
      this._debouncedEllipseUpdaters.set(id, updater);
    }
    updater(ellipse);
  }

  private readonly historyManager: HistoryManager;

  constructor(historyManager: HistoryManager) {
    super();
    this.historyManager = historyManager;
  }

  /** Returns the Ids of all geometry items */
  getAllGeometryIds(): Set<Id> {
    const ids = new Set<Id>();
    for (const id of this.geometryById.keys()) {
      ids.add(id);
    }
    for (const c of this.constraints) {
      ids.add(c.id);
    }
    return ids;
  }

  /** Returns all inner geometry items with volume (polygons, rectangles, ellipses, etc) converted
   * into polygon segments. Used for intersection detection among other things. */
  getAllGeometryAsSegments(): Array<{
    type: 'polygon' | 'rectangle' | 'ellipse';
    id: Id;
    segments: Array<{
      index: number;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
    }>;
  }> {
    const pointsToSegments = (points: Array<PolygonSegment>) => {
      const segments = [];
      let lastPoint = null;
      for (let index = 0; index < points.length; index += 1) {
        const seg = points[index];
        switch (seg.type) {
          case 'point':
            if (lastPoint) {
              segments.push({ index, segment: { start: lastPoint, end: seg.point } });
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

    const result: Array<{
      type: 'polygon' | 'rectangle' | 'ellipse';
      id: Id;
      segments: Array<{
        index: number;
        segment:
          | LineSegment<SheetPosition>
          | QuadraticCurve<SheetPosition>
          | CubicCurve<SheetPosition>;
      }>;
    }> = [];
    for (const g of this.geometryById.values()) {
      if (isPolygon(g)) {
        result.push({ type: 'polygon', id: g.id, segments: pointsToSegments(g.points) });
      } else if (isRectangle(g)) {
        result.push({
          type: 'rectangle',
          id: g.id,
          segments: pointsToSegments(rectangleToPolygon(g.upperLeft, g.lowerRight)),
        });
      } else if (isEllipse(g)) {
        result.push({
          type: 'ellipse',
          id: g.id,
          segments: pointsToSegments(ellipseToPolygon(g.center, g.radiusX, g.radiusY)),
        });
      }
    }
    return result;
  }

  getById(id: Id): Polygon | Rectangle | Ellipse | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined') {
      if (isPolygon(g)) return g;
      if (isRectangle(g)) return g;
      if (isEllipse(g)) return g;
    }
    return null;
  }

  deleteById(id: Id) {
    this.deletePolygon(id);
    this.deleteRectangle(id);
    this.deleteEllipse(id);
    this.deleteConstraint(id);
  }

  /** Removes all geometry (polygons, rectangles, ellipses) from the store and resets the DCEL index.
   *  Does NOT clear constraints. */
  clearAll(): void {
    this.geometryById.clear();
    this.dcelIndex = new DCELShapeIndex();
    this._debouncedPolygonUpdaters.clear();
    this._debouncedRectangleUpdaters.clear();
    this._debouncedEllipseUpdaters.clear();
  }

  /** Sets the fill color of a Geometry<FillColorComponent>. Does NOT record to history - use setFillColor for that.
   * Internal version used by HistoryManager. */
  setFillColorDirect(id: Id, color: number | null): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, FillColorComponent)) {
      return;
    }

    const updated = FillColorComponent.update({ ...geometry, fillColor: color }, color);
    this.geometryById.set(id, updated);
    this.emit('geometryUpdated', updated);

    if (isRectangle(updated)) {
      this.emit('rectanglesChanged', this.rectangles);
    } else if (isEllipse(updated)) {
      this.emit('ellipsesChanged', this.ellipses);
    } else if (isPolygon(updated)) {
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /** Sets the fill color of a {@link Geometry<FillColorComponent>}, recording the change to history. */
  setFillColor(id: Id, color: number | null): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, FillColorComponent)) {
      return;
    }

    const beforeColor = FillColorComponent.get(geometry);
    if (beforeColor === color) {
      return;
    }

    if (isRectangle(geometry)) {
      this.historyManager.apply(UndoEntry.rectangleFillColor(id, beforeColor, color));
    } else if (isEllipse(geometry)) {
      this.historyManager.apply(UndoEntry.ellipseFillColor(id, beforeColor, color));
    } else if (isPolygon(geometry)) {
      this.historyManager.apply(UndoEntry.polygonFillColor(id, beforeColor, color));
    }
  }

  /** Sets the fill color of a Geometry<RenderOrderComponent>. Does NOT record to history - use setRenderOrder for that.
   * Internal version used by HistoryManager. */
  setRenderOrderDirect(id: Id, order: number): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, RenderOrderComponent)) {
      return;
    }

    const updated = RenderOrderComponent.update({ ...geometry, renderOrder: order }, order);
    this.geometryById.set(id, updated);
    this.emit('geometryUpdated', updated);

    if (isRectangle(updated)) {
      this.emit('rectanglesChanged', this.rectangles);
    } else if (isEllipse(updated)) {
      this.emit('ellipsesChanged', this.ellipses);
    } else if (isPolygon(updated)) {
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /** Sets the fill color of a {@link Geometry<RenderOrderComponent>}, recording the change to history. */
  setRenderOrder(id: Id, order: number): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, RenderOrderComponent)) {
      return;
    }

    const beforeOrder = RenderOrderComponent.get(geometry);
    if (beforeOrder === order) {
      return;
    }

    if (isRectangle(geometry)) {
      this.historyManager.apply(UndoEntry.rectangleRenderOrder(id, beforeOrder, order));
    } else if (isEllipse(geometry)) {
      this.historyManager.apply(UndoEntry.ellipseRenderOrder(id, beforeOrder, order));
    } else if (isPolygon(geometry)) {
      this.historyManager.apply(UndoEntry.polygonRenderOrder(id, beforeOrder, order));
    }
  }

  // ==================== POLYGON METHODS ====================

  /**
   * Adds a polygon, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addPolygon(polygon: PolygonTemplate): Polygon {
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);
    const renderOrder = this.getMaxRenderOrder()[0] + 1;

    const fullPolygon: Polygon = {
      ...polygon,
      id,
      renderOrder,
      components: {
        ...polygon.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    };

    this.historyManager.apply(UndoEntry.polygonInsert(fullPolygon));
    return fullPolygon;
  }

  /**
   * Internal version of addPolygon that uses an existing polygon with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addPolygonDirect(polygon: Polygon): void {
    this.geometryById.set(polygon.id, polygon);
    this.dcelIndex.addPolygon(polygon);
    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', polygon);
    this.emit('geometryAdded', polygon);
  }

  getPolygonById(id: Id): Polygon | null {
    const g = this.geometryById.get(id);
    return g && isPolygon(g) ? g : null;
  }

  getPolygonByPoint(point: SheetPosition): Array<[Polygon, number /* point index */]> {
    const results: Array<[Polygon, number]> = [];
    for (const g of this.geometryById.values()) {
      if (!isPolygon(g)) continue;
      const index = g.points.findIndex((seg) => seg.point.x === point.x && seg.point.y === point.y);
      if (index >= 0) {
        results.push([g, index]);
      }
    }
    return results;
  }

  /** Finds all point segments across all polygons that are at exactly the same position as the given point. */
  findMatchingPoints(
    point: SheetPosition,
    excludePolygonId?: Id,
  ): Array<{ polygonId: Id; segmentIndex: number }> {
    const matches: Array<{ polygonId: Id; segmentIndex: number }> = [];
    for (const g of this.geometryById.values()) {
      if (!isPolygon(g)) continue;
      if (excludePolygonId && g.id === excludePolygonId) continue;
      for (let i = 0; i < g.points.length; i++) {
        const seg = g.points[i];
        if (seg.type === 'point' && seg.point.x === point.x && seg.point.y === point.y) {
          matches.push({ polygonId: g.id, segmentIndex: i });
        }
      }
    }
    return matches;
  }

  /** Returns all constraints whose endpoints reference the given geometry ID
   *  (via locked-rectangle, locked-ellipse, or locked-polygon). */
  findConstraintsByGeometryId(geometryId: Id): Array<Constraint> {
    return this.constraints.filter((c) => {
      const attached = (ep: ConstraintEndpoint) =>
        (ep.type === 'locked-rectangle' ||
          ep.type === 'locked-ellipse' ||
          ep.type === 'locked-polygon') &&
        ep.id === geometryId;
      return attached(c.pointA) || attached(c.pointB);
    });
  }

  /** Updates a polygon by id. Does NOT record to history - use updatePolygon for that.
   * Internal version used by HistoryManager. */
  updatePolygonDirect(
    id: Id,
    updatesOrFn: Partial<Polygon> | ((old: Polygon) => Polygon),
  ): [Polygon, Polygon] | null {
    const before = this.getPolygonById(id);
    if (!before) {
      return null;
    }

    let after: Polygon;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.geometryById.set(id, after);

    if (before.points !== after.points) {
      this.syncPolygonUpdateToDecl(after.id, after);
    }

    this.emit('polygonsChanged', this.polygons);
    this.emit('geometryUpdated', after);
    return [before, after] as const;
  }

  /** Updates a polygon by id, recording the change to history. */
  updatePolygon(id: Id, updatesOrFn: Partial<Polygon> | ((old: Polygon) => Polygon)): void {
    const results = this.updatePolygonDirect(id, updatesOrFn);
    if (!results) {
      return;
    }
    const [before, after] = results;

    if (after.points && after.points !== before.points) {
      this.historyManager.push(UndoEntry.polygonMove(id, before.points, after.points));
    }
    this.emit('polygonsChanged', this.polygons);
    this.emit('geometryUpdated', after);
  }

  /** Deletes a polygon by id, recording the deletion to history. */
  deletePolygon(id: Id): void {
    const polygon = this.getPolygonById(id);
    if (polygon) {
      this.historyManager.apply(UndoEntry.polygonDelete(polygon));
    }
  }

  /**
   * Internal version of deletePolygon that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deletePolygonDirect(id: Id): void {
    this.geometryById.delete(id);

    // FIXME: sync deletes to constraints?
    this.dcelIndex.removePolygon(id);

    this.emit('polygonsChanged', this.polygons);
    this.emit('geometryDeleted', id);
  }

  /**
   * Inserts a new point segment at the specified position, splitting the line segment edge
   * between segmentIndex and segmentIndex+1. Only works for point-type segments.
   * Records the insertion to history for undo/redo.
   */
  addPointOnLineSegmentEdge(polygonId: Id, segmentIndex: number, newPoint: SheetPosition): void {
    const polygon = this.getPolygonById(polygonId);
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

    this.updatePolygonDirect(polygonId, { points: afterSegments });
    this.historyManager.push(
      UndoEntry.polygonInsertPoint(
        polygonId,
        segmentIndex,
        newPoint,
        beforeSegments,
        afterSegments,
      ),
    );
  }

  /**
   * Inserts a new point segment at the specified position on a quadratic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-quadratic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnQuadraticEdge(
    polygonId: Id,
    segmentIndex: number,
    t: number,
    newPoint: SheetPosition,
  ): void {
    const polygon = this.getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.slice();

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];

    if (
      !pointSegment ||
      !arcSegment ||
      pointSegment.type !== 'point' ||
      arcSegment.type !== 'arc-quadratic'
    ) {
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

    this.updatePolygonDirect(polygonId, { points: afterSegments });
    this.historyManager.push(
      UndoEntry.polygonInsertPoint(
        polygonId,
        segmentIndex,
        newPoint,
        beforeSegments,
        afterSegments,
      ),
    );
  }

  /**
   * Inserts a new point segment at the specified position on a cubic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-cubic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnCubicEdge(
    polygonId: Id,
    segmentIndex: number,
    t: number,
    newPoint: SheetPosition,
  ): void {
    const polygon = this.getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const beforeSegments = polygon.points.slice();

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];

    if (
      !pointSegment ||
      !arcSegment ||
      pointSegment.type !== 'point' ||
      arcSegment.type !== 'arc-cubic'
    ) {
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

    this.updatePolygonDirect(polygonId, { points: afterSegments });
    this.historyManager.push(
      UndoEntry.polygonInsertPoint(
        polygonId,
        segmentIndex,
        newPoint,
        beforeSegments,
        afterSegments,
      ),
    );
  }

  setWorkingPolygon(
    updatesOrFn: WorkingPolygon | null | ((old: WorkingPolygon | null) => WorkingPolygon | null),
  ): void {
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

  /** Sets the fill color of a polygon, recording the change to history. @deprecated */
  setPolygonFillColor(id: Id, color: number | null): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    const beforeColor = polygon.fillColor;
    if (beforeColor === color) return;
    this.historyManager.apply(UndoEntry.polygonFillColor(id, beforeColor, color));
  }

  /** Sets the openAtIndex of a polygon. Does NOT record to history - use setPolygonOpenAtIndex for that.
   * Internal version used by HistoryManager. Automatically bounds to valid range. */
  setPolygonOpenAtIndexDirect(id: Id, index: number): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    const boundedIndex = Math.max(0, Math.min(index, polygon.points.length - 1));
    if (polygon.openAtIndex === boundedIndex) return;
    this.updatePolygonDirect(id, { openAtIndex: boundedIndex });
  }

  /** Sets the openAtIndex of a polygon. Automatically bounds to valid range. */
  setPolygonOpenAtIndex(id: Id, index: number): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    const boundedIndex = Math.max(0, Math.min(index, polygon.points.length - 1));
    if (polygon.openAtIndex === boundedIndex) return;
    const beforeIndex = polygon.openAtIndex;
    this.historyManager.apply(UndoEntry.polygonOpenAtIndex(id, beforeIndex, boundedIndex));
  }

  /** Sets the render order of a polygon. Does NOT record to history - use setPolygonRenderOrder for that.
   * Internal version used by HistoryManager. */
  setPolygonRenderOrderDirect(id: Id, order: number): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    if (polygon.renderOrder === order) return;
    this.updatePolygonDirect(id, { renderOrder: order });
  }

  /** Sets the render order of a polygon, recording the change to history. */
  setPolygonRenderOrder(id: Id, order: number): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    if (polygon.renderOrder === order) return;
    const beforeOrder = polygon.renderOrder;
    this.historyManager.apply(UndoEntry.polygonRenderOrder(id, beforeOrder, order));
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
    const polygon = this.getPolygonById(id);
    if (!polygon || polygon.closed || polygon.points.length < 3) {
      return;
    }
    this.historyManager.apply(UndoEntry.polygonClose(id, false, true));
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
          ...polygon.points.slice(
            polygon.openAtIndex + 1,
            -1 /* remove closed mode "duplicate" point */,
          ),
          ...polygon.points.slice(0, polygon.openAtIndex + 1),
        ],
        closed: false,
      };
    });
  }

  /** Opens a polygon, recording the change to history. */
  openPolygon(id: Id): void {
    const polygon = this.getPolygonById(id);
    if (!polygon || !polygon.closed || polygon.points.length < 3) {
      return;
    }
    this.historyManager.apply(UndoEntry.polygonClose(id, true, false));
  }

  // ==================== RECTANGLE METHODS ====================

  /**
   * Adds a rectangle, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addRectangle(rectangle: RectangleTemplate): Rectangle {
    const id = this.historyManager.generateStableId(ID_PREFIXES.rectangle);
    const renderOrder = this.getMaxRenderOrder()[0] + 1;

    const fullRectangle: Rectangle = {
      ...rectangle,
      id,
      renderOrder,
      components: {
        ...rectangle.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    };

    this.historyManager.apply(UndoEntry.rectangleInsert(fullRectangle));
    return fullRectangle;
  }

  /**
   * Internal version of addRectangle that uses an existing rectangle with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addRectangleDirect(rectangle: Rectangle): void {
    this.geometryById.set(rectangle.id, rectangle);
    this.dcelIndex.addRectangle(rectangle);
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('rectangleAdded', rectangle);
    this.emit('geometryAdded', rectangle);
  }

  getRectangleById(id: Id): Rectangle | null {
    const g = this.geometryById.get(id);
    return g && isRectangle(g) ? g : null;
  }

  /** Updates a rectangle by id. Does NOT record to history - use updateRectangle for that.
   * Internal version used by HistoryManager. */
  updateRectangleDirect(
    id: Id,
    updatesOrFn: Partial<Rectangle> | ((old: Rectangle) => Rectangle),
  ): [Rectangle, Rectangle] | null {
    const before = this.getRectangleById(id);
    if (!before) {
      return null;
    }

    let after: Rectangle;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.geometryById.set(id, after);

    if (before.upperLeft !== after.upperLeft || before.lowerRight !== after.lowerRight) {
      this.syncRectangleUpdateToDecl(after.id, after);
    }

    this.emit('rectanglesChanged', this.rectangles);
    this.emit('geometryUpdated', after);
    return [before, after];
  }

  /** Updates a rectangle by id, recording the change to history. */
  updateRectangle(id: Id, updatesOrFn: Partial<Rectangle> | ((old: Rectangle) => Rectangle)): void {
    const before = this.getRectangleById(id);
    if (!before) {
      return;
    }
    const after =
      typeof updatesOrFn === 'function' ? updatesOrFn(before) : { ...before, ...updatesOrFn };
    if (after.upperLeft !== before.upperLeft || after.lowerRight !== before.lowerRight) {
      this.historyManager.apply(UndoEntry.rectangleMove(id, before, after));
    }
  }

  /** Deletes a rectangle by id, recording the deletion to history. */
  deleteRectangle(id: Id): void {
    const rectangle = this.getRectangleById(id);
    if (rectangle) {
      // FIXME: sync deletes to constraints?
      this.historyManager.apply(UndoEntry.rectangleDelete(rectangle));
    }
  }

  /**
   * Internal version of deleteRectangle that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteRectangleDirect(id: Id): void {
    this.geometryById.delete(id);
    this.dcelIndex.removeRectangle(id);
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('geometryDeleted', id);
  }

  setWorkingRectangle(wr: WorkingRectangle | null): void {
    this.workingRectangle = wr;
    this.emit('workingRectangleChanged', wr);
  }

  clearWorkingRectangle(): void {
    this.workingRectangle = null;
    this.emit('workingRectangleChanged', null);
  }

  /** Sets the fill color of a rectangle, recording the change to history. @deprecated */
  setRectangleFillColor(id: Id, color: number | null): void {
    const rectangle = this.getRectangleById(id);
    if (!rectangle) {
      return;
    }
    const beforeColor = rectangle.fillColor;
    if (beforeColor === color) return;
    this.historyManager.apply(UndoEntry.rectangleFillColor(id, beforeColor, color));
  }

  /** Sets the linkDimensions flag of a rectangle. Does NOT record to history - use setRectangleLinkDimensions for that.
   * Internal version used by HistoryManager. */
  setRectangleLinkDimensionsDirect(id: Id, link: boolean): void {
    const rect = this.getRectangleById(id);
    if (!rect) return;
    const updated: Rectangle = { ...rect, linkDimensions: link };
    this.geometryById.set(id, LinkDimensionsComponent.update(updated, link));
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('geometryUpdated', updated);
  }

  /** Sets the linkDimensions flag of a rectangle, recording the change to history. */
  setRectangleLinkDimensions(id: Id, link: boolean): void {
    const rectangle = this.getRectangleById(id);
    if (!rectangle) return;
    const beforeLink = rectangle.linkDimensions;
    if (beforeLink === link) return;
    this.historyManager.apply(UndoEntry.rectangleLinkDimensions(id, beforeLink, link));
  }

  /** Takes the passed rectangle, deletes it, and converts it to a polygon. Records as a single
   * atomic conversion operation. */
  convertRectangleToPolygon(rectangleId: Id): Polygon {
    const rectangle = this.getRectangleById(rectangleId);
    if (!rectangle) {
      throw new Error(
        `GeometryStore.convertRectangleToPolygon: Cannot find rectangle ${rectangleId}`,
      );
    }
    const points = rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight);
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);

    const polygonTemplate = Polygon.create(points, {
      closed: true,
      fillColor: rectangle.fillColor,
      openAtIndex: 0,
    });
    const polygon: Polygon = {
      id,
      renderOrder: rectangle.renderOrder,

      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(rectangle.renderOrder),
      },
    };

    this.addPolygonDirect(polygon);
    this.deleteRectangleDirect(rectangleId);
    this.historyManager.push(UndoEntry.rectangleToPolygon(rectangle, polygon));
    return polygon;
  }

  // ==================== ELLIPSE METHODS ====================

  /**
   * Adds an ellipse, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addEllipse(ellipse: EllipseTemplate): Ellipse {
    const id = this.historyManager.generateStableId(ID_PREFIXES.ellipse);
    const renderOrder = this.getMaxRenderOrder()[0] + 1;
    const fullEllipse: Ellipse = {
      ...ellipse,
      id,
      renderOrder,
      components: {
        ...ellipse.components,
        ...RenderOrderComponent.create(renderOrder),
      },
    };
    this.historyManager.apply(UndoEntry.ellipseInsert(fullEllipse));
    return fullEllipse;
  }

  /**
   * Internal version of addEllipse that uses an existing ellipse with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addEllipseDirect(ellipse: Ellipse): void {
    this.geometryById.set(ellipse.id, ellipse);
    this.dcelIndex.addEllipse(ellipse);
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('ellipseAdded', ellipse);
    this.emit('geometryAdded', ellipse);
  }

  getEllipseById(id: Id): Ellipse | null {
    const g = this.geometryById.get(id);
    return g && isEllipse(g) ? g : null;
  }

  /** Updates an ellipse by id. Does NOT record to history - use updateEllipse for that.
   * Internal version used by HistoryManager. */
  updateEllipseDirect(
    id: Id,
    updatesOrFn: Partial<Ellipse> | ((old: Ellipse) => Ellipse),
  ): [Ellipse, Ellipse] | null {
    const before = this.getEllipseById(id);
    if (!before) {
      return null;
    }

    let after: Ellipse;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.geometryById.set(id, after);

    if (
      before.center !== after.center ||
      before.radiusX !== after.radiusX ||
      before.radiusY !== after.radiusY
    ) {
      this.syncEllipseUpdateToDcel(after.id, after);
    }

    this.emit('ellipsesChanged', this.ellipses);
    this.emit('geometryUpdated', after);
    return [before, after];
  }

  /** Updates an ellipse by id, recording the change to history. */
  updateEllipse(id: Id, updatesOrFn: Partial<Ellipse> | ((old: Ellipse) => Ellipse)): void {
    const before = this.getEllipseById(id);
    if (!before) {
      return;
    }
    const after =
      typeof updatesOrFn === 'function' ? updatesOrFn(before) : { ...before, ...updatesOrFn };
    if (
      after.center !== before.center ||
      after.radiusX !== before.radiusX ||
      after.radiusY !== before.radiusY
    ) {
      this.historyManager.apply(UndoEntry.ellipseMove(id, before, after));
    }
  }

  /** Deletes an ellipse by id, recording the deletion to history. */
  deleteEllipse(id: Id): void {
    const ellipse = this.getEllipseById(id);
    if (ellipse) {
      // FIXME: sync deletes to constraints?
      this.historyManager.apply(UndoEntry.ellipseDelete(ellipse));
    }
  }

  /**
   * Internal version of deleteEllipse that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteEllipseDirect(id: Id): void {
    this.geometryById.delete(id);
    this.dcelIndex.removeEllipse(id);
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('geometryDeleted', id);
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

    const polygonTemplate = Polygon.create(points, {
      closed: true,
      fillColor: ellipse.fillColor,
      openAtIndex: 0,
    });
    const polygon: Polygon = {
      id,
      renderOrder: ellipse.renderOrder,

      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(ellipse.renderOrder),
      },
    };

    this.addPolygonDirect(polygon);
    this.deleteEllipseDirect(ellipseId);
    this.historyManager.push(UndoEntry.ellipseToPolygon(ellipse, polygon));
    return polygon;
  }

  /** Sets the fill color of an ellipse, recording the change to history. @deprecated */
  setEllipseFillColor(id: Id, color: number | null): void {
    const ellipse = this.getEllipseById(id);
    if (!ellipse) return;
    const beforeColor = ellipse.fillColor;
    if (beforeColor === color) return;
    this.historyManager.apply(UndoEntry.ellipseFillColor(id, beforeColor, color));
  }

  /** Sets the linkDimensions flag of an ellipse. Does NOT record to history - use setEllipseLinkDimensions for that.
   * Internal version used by HistoryManager. */
  setEllipseLinkDimensionsDirect(id: Id, link: boolean): void {
    const ellipse = this.getEllipseById(id);
    if (!ellipse) return;
    const updated: Ellipse = { ...ellipse, linkDimensions: link };
    this.geometryById.set(id, LinkDimensionsComponent.update(updated, link));
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('geometryUpdated', updated);
  }

  /** Sets the linkDimensions flag of an ellipse, recording the change to history. */
  setEllipseLinkDimensions(id: Id, link: boolean): void {
    const ellipse = this.getEllipseById(id);
    if (!ellipse) return;
    const beforeLink = ellipse.linkDimensions;
    if (beforeLink === link) return;
    this.historyManager.apply(UndoEntry.ellipseLinkDimensions(id, beforeLink, link));
  }

  /** Sets the render order of an ellipse. Does NOT record to history - use setEllipseRenderOrder for that.
   * Internal version used by HistoryManager. */
  setEllipseRenderOrderDirect(id: Id, order: number): void {
    const ellipse = this.getEllipseById(id);
    if (!ellipse) return;
    if (ellipse.renderOrder === order) return;
    const updated: Ellipse = { ...ellipse, renderOrder: order };
    this.geometryById.set(id, RenderOrderComponent.update(updated, order));
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('geometryUpdated', updated);
  }

  /** Sets the render order of an ellipse, recording the change to history. */
  setEllipseRenderOrder(id: Id, order: number): void {
    const ellipse = this.getEllipseById(id);
    if (!ellipse) return;
    if (ellipse.renderOrder === order) return;
    const beforeOrder = ellipse.renderOrder;
    this.historyManager.apply(UndoEntry.ellipseRenderOrder(id, beforeOrder, order));
  }

  /** Sets the render order of a rectangle. Does NOT record to history - use setRectangleRenderOrder for that.
   * Internal version used by HistoryManager. */
  setRectangleRenderOrderDirect(id: Id, order: number): void {
    const rect = this.getRectangleById(id);
    if (!rect) return;
    if (rect.renderOrder === order) return;
    const updated: Rectangle = { ...rect, renderOrder: order };
    this.geometryById.set(id, RenderOrderComponent.update(updated, order));
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('geometryUpdated', updated);
  }

  /** Sets the render order of a rectangle, recording the change to history. */
  setRectangleRenderOrder(id: Id, order: number): void {
    const rectangle = this.getRectangleById(id);
    if (!rectangle) return;
    if (rectangle.renderOrder === order) return;
    const beforeOrder = rectangle.renderOrder;
    this.historyManager.apply(UndoEntry.rectangleRenderOrder(id, beforeOrder, order));
  }

  // ==================== CONSTRAINT METHODS ====================

  /**
   * Adds an constraint, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addConstraint(constraint: ConstraintTemplate): Constraint {
    const id = this.historyManager.generateStableId(ID_PREFIXES.constraint);
    const fullConstraint: Constraint = { ...constraint, id };
    this.historyManager.apply(UndoEntry.linearConstraintInsert(fullConstraint));
    return fullConstraint;
  }

  /**
   * Internal version of addConstraint that uses an existing constraint with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addConstraintDirect(constraint: Constraint): void {
    this.constraints.push(constraint);
    this.emit('constraintsChanged', this.constraints.slice());
    this.emit('constraintAdded', constraint);
  }

  getConstraintById(id: Id): Constraint | null {
    return this.constraints.find((e) => e.id === id) ?? null;
  }

  /** Updates an constraint by id. Does NOT record to history - use updateConstraint for that.
   * Internal version used by HistoryManager. */
  updateConstraintDirect(
    id: Id,
    updatesOrFn: Partial<Constraint> | ((old: Constraint) => Constraint),
  ): void {
    const index = this.constraints.findIndex((e) => e.id === id);
    if (index < 0) {
      return;
    }

    const before = this.constraints[index];
    let after: Constraint;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.constraints[index] = after;
    this.emit('constraintsChanged', this.constraints.slice());
  }

  /** Updates an constraint by id, recording the change to history. */
  updateConstraint(
    id: Id,
    updatesOrFn: Partial<Constraint> | ((old: Constraint) => Constraint),
  ): void {
    const index = this.constraints.findIndex((e) => e.id === id);
    if (index < 0) {
      return;
    }

    const before = this.constraints[index];
    let after: Constraint;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.constraints[index] = after;
    if (
      !ConstraintEndpoint.equal(before.pointA, after.pointA) ||
      !ConstraintEndpoint.equal(before.pointB, after.pointB)
    ) {
      this.historyManager.push(
        UndoEntry.linearConstraintMoveEndpoints(
          id,
          before.pointA,
          before.pointB,
          after.pointA,
          after.pointB,
        ),
      );
    }
    if (before.connectorLineOffsetPx !== after.connectorLineOffsetPx) {
      this.historyManager.push(
        UndoEntry.linearConstraintMoveLabel(
          id,
          before.connectorLineOffsetPx,
          after.connectorLineOffsetPx,
        ),
      );
    }
    if (before.constrainedLength !== after.constrainedLength) {
      this.historyManager.push(
        UndoEntry.linearConstraintChangeLength(
          id,
          before.constrainedLength,
          after.constrainedLength,
        ),
      );
    }
    this.emit('constraintsChanged', this.constraints.slice());
  }

  /** Resolves a ConstraintEndpoint to a concrete SheetPosition.
   *  For locked endpoints, looks up the geometry by ID and extracts the requested point.
   *  Returns null if the referenced geometry no longer exists or the point index is out of range. */
  resolveConstraintEndpoint(endpoint: ConstraintEndpoint): SheetPosition | null {
    switch (endpoint.type) {
      case 'point':
        return endpoint.point;
      case 'locked-rectangle': {
        const rect = this.getRectangleById(endpoint.id);
        if (!rect) {
          return null;
        }
        const corners = rectCorners(geometryBoundingBox(rect)!);
        return corners[endpoint.point];
      }
      case 'locked-ellipse': {
        const ellipse = this.getEllipseById(endpoint.id);
        if (!ellipse) {
          return null;
        }
        const points = ellipsePoints(ellipse);
        return points[endpoint.point];
      }
      case 'locked-polygon': {
        const polygon = this.getPolygonById(endpoint.id);
        if (!polygon || endpoint.pointIndex >= polygon.points.length) {
          return null;
        }
        return polygon.points[endpoint.pointIndex].point;
      }
    }
  }

  setWorkingConstraints(
    valueOrUpdater:
      | Array<WorkingConstraint>
      | ((old: Array<WorkingConstraint>) => Array<WorkingConstraint>),
  ): void {
    this.workingConstraints =
      typeof valueOrUpdater === 'function'
        ? valueOrUpdater(this.workingConstraints)
        : valueOrUpdater;
    this.emit('workingConstraintsChanged', this.workingConstraints.slice());
  }

  clearWorkingConstraints(): void {
    this.setWorkingConstraints([]);
  }

  /** Deletes an constraint by id, recording the deletion to history. */
  deleteConstraint(id: Id): void {
    const constraint = this.constraints.find((e) => e.id === id);
    if (constraint) {
      this.historyManager.apply(UndoEntry.linearConstraintDelete(constraint));
    }
  }

  /**
   * Internal version of deleteConstraint that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deleteConstraintDirect(id: Id): void {
    this.constraints = this.constraints.filter((e) => e.id !== id);
    this.emit('constraintsChanged', this.constraints.slice());
  }

  /** Re-solve all constraints and attempt to get them all to be conflict free.
   * NOTE: Potentially relocates geometry to get all constraints to validate.
   *
   * If passed, optionally specify a list of positions which should NOT move / should be fixed in
   * place. Use this when a mouse cursor is moving a point / etc and that point is in a known good
   * position.*/
  reconstrain(sheetUnit: UnitType, fixedPositions: Array<SheetPosition>) {
    // Step 1: Compute all constraints by resolving any user defined constraints against the DCEL
    // index.
    const { engineConstraints, positions } = this.dcelIndex.computeEngineConstraints(
      this.constraints,
      fixedPositions,
      sheetUnit,
    );
    console.log('Constraints:', engineConstraints);
    const positionsKeyOrder = generatePositionsKeyOrder(positions);

    // Step 2: Solve the constraints by minimizing the constraint loss functions with gradient
    // descent.
    const result = gradientDescent(
      positionsToState(positionsKeyOrder, positions),
      (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
      CONSTRAINT_SOLVER_MAX_ITERATIONS,
    );
    console.log('Input:', positions);

    const resultPositions = stateToPositions(positionsKeyOrder, result.input);
    const inConflict = isInConflict(engineConstraints, resultPositions);

    console.log(
      'Converged?',
      result.converged,
      'Constraints in Conflict:',
      inConflict,
      'Iterations:',
      result.iterations,
    );
    console.log('Result:', resultPositions);

    // Step 3: Sync updated point positions back to any given geometries
    const touchedGeometries = this.historyManager.applyTransaction('reconstrain', () => {
      type Update = ReturnType<typeof this.dcelIndex.computeShapesForVertexId>[0];
      const shapeUpdatesById = new Map<Id, Array<{ update: Update; position: SheetPosition }>>();
      for (const [vertexId, position] of resultPositions) {
        for (const update of this.dcelIndex.computeShapesForVertexId(vertexId as VertexId)) {
          const list = shapeUpdatesById.get(update.id) ?? [];
          list.push({ update, position });
          shapeUpdatesById.set(update.id, list);
        }
      }

      const touchedGeometries = new Map<Id, 'polygon' | 'ellipse' | 'rectangle'>();
      for (const [id, updates] of shapeUpdatesById) {
        switch (updates[0].update.type) {
          case 'polygon':
            this.updatePolygon(id, (old) => {
              const points = old.points.slice();
              for (const { update, position } of updates) {
                // FIXME: address typing, make shape update a proper enum
                points[(update as any).pointIndex] = {
                  ...points[(update as any).pointIndex],
                  point: position,
                };
              }
              return { ...old, points };
            });
            touchedGeometries.set(id, 'polygon');
            break;

          case 'rectangle':
            this.updateRectangle(id, (old) => {
              let working = old;
              for (const { update, position } of updates) {
                switch (update.point) {
                  case 'upperLeft':
                    working = { ...working, upperLeft: position };
                    break;
                  case 'lowerRight':
                    working = { ...working, lowerRight: position };
                    break;
                  case 'upperRight':
                    working = {
                      ...working,
                      upperLeft: new SheetPosition(working.upperLeft.x, position.y),
                      lowerRight: new SheetPosition(position.x, working.lowerRight.y),
                    };
                    break;
                  case 'lowerLeft':
                    working = {
                      ...working,
                      upperLeft: new SheetPosition(position.x, working.upperLeft.y),
                      lowerRight: new SheetPosition(working.lowerRight.x, position.y),
                    };
                    break;
                }
              }
              return working;
            });
            touchedGeometries.set(id, 'rectangle');
            break;

          case 'ellipse':
            this.updateEllipse(id, (old) => {
              // NOTE: the ordering here is really important.
              // The center has to be dealt with first
              // And then the perimeter positions subtracted from the up to date center
              //
              // If you subtract the perimeter positions against the out of date center, then the
              // results of the constraint cannot be expressed faithfully
              const foundCenter = updates.findLast((u) => u.update.point === 'center');
              const center = foundCenter ? foundCenter.position : old.center;

              let radiusX = old.radiusX;
              const foundLeft = updates.findLast((u) => u.update.point === 'left');
              if (foundLeft) {
                radiusX = center.x - foundLeft.position.x;
              }
              const foundRight = updates.findLast((u) => u.update.point === 'right');
              if (foundRight) {
                radiusX = foundRight.position.x - center.x;
              }

              let radiusY = old.radiusY;
              const foundTop = updates.findLast((u) => u.update.point === 'top');
              if (foundTop) {
                radiusY = center.y - foundTop.position.y;
              }
              const foundBottom = updates.findLast((u) => u.update.point === 'bottom');
              if (foundBottom) {
                radiusY = foundBottom.position.y - center.y;
              }

              return { ...old, center, radiusX, radiusY };
            });
            touchedGeometries.set(id, 'ellipse');
            break;
        }
      }
      return touchedGeometries;
    });

    // Step 4: resync updates immediately to the DCEL
    // If this isn't immediately done, then the debounce threshold will flicker / take a while
    // for this to happen, and it will make the ui look broken while it waits
    for (const [id, type] of touchedGeometries) {
      switch (type) {
        case 'rectangle':
          const rectangle = this.getRectangleById(id);
          if (rectangle) {
            this.syncRectangleUpdateToDecl(id, rectangle, true);
          }
          break;
        case 'ellipse':
          const ellipse = this.getEllipseById(id);
          if (ellipse) {
            this.syncEllipseUpdateToDcel(id, ellipse, true);
          }
          break;
        case 'polygon':
          const polygon = this.getPolygonById(id);
          if (polygon) {
            this.syncPolygonUpdateToDecl(id, polygon, true);
          }
          break;
        default:
          (type) satisfies never;
          break;
      }
    }

    // FIXME: to get constraints to not flicker too, as part of step 5, find all touched constraints
    // and directly update them too with this.updateConstraint
  }

  // ==================== RENDER ORDER ====================

  /** Returns the maximum render order across all geometry and the number of geometries at that max, or 0 if no geometry exists. */
  getMaxRenderOrder(): [number, number] {
    let max = 0;
    let maxCount = 0;
    for (const g of this.geometryById.values()) {
      if (!Geometry.hasComponent(g, RenderOrderComponent)) continue;
      const order = RenderOrderComponent.get(g);
      if (order > max) {
        max = order;
        maxCount = 1;
      } else if (order === max) {
        maxCount += 1;
      }
    }
    return [max, maxCount];
  }
}
