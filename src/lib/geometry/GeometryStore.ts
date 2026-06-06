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
import {
  EllipseComponent,
  FillColorComponent,
  Geometry,
  type Id,
  LinkDimensionsComponent,
  PolygonComponent,
  RectangleComponent,
  RenderOrderComponent,
  isPolygon,
} from '@/lib/geometry';
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
  geometryDeleted: (geometryId: Geometry['id']) => void;
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
    return Array.from(this.geometryById.values()).filter((g): g is Rectangle =>
      Geometry.hasComponent(g, RectangleComponent),
    );
  }

  get ellipses(): Array<Ellipse> {
    return Array.from(this.geometryById.values()).filter((g): g is Ellipse =>
      Geometry.hasComponent(g, EllipseComponent),
    );
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
  private _debouncedDcelUpdaters = new Map<Id, ReturnType<typeof debounce>>();
  private _syncDcelUpdate(geometry: Geometry, immediate?: boolean): void {
    const id = geometry.id;
    if (immediate) {
      this.dcelIndex.updateGeometry(geometry);
      this._debouncedDcelUpdaters.delete(id);
      return;
    }

    let updater = this._debouncedDcelUpdaters.get(id);
    if (typeof updater === 'undefined') {
      updater = debounce((g: Geometry) => {
        this.dcelIndex.updateGeometry(g);
        this._debouncedDcelUpdaters.delete(g.id);
      }, 200);
      this._debouncedDcelUpdaters.set(id, updater);
    }
    updater(geometry);
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
        result.push({
          type: 'polygon',
          id: g.id,
          segments: pointsToSegments(PolygonComponent.get(g).points),
        });
      } else if (Geometry.hasComponent(g, RectangleComponent)) {
        const rectangle = RectangleComponent.get(g);
        result.push({
          type: 'rectangle',
          id: g.id,
          segments: pointsToSegments(rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight)),
        });
      } else if (Geometry.hasComponent(g, EllipseComponent)) {
        const ellipseData = EllipseComponent.get(g);
        result.push({
          type: 'ellipse',
          id: g.id,
          segments: pointsToSegments(
            ellipseToPolygon(ellipseData.center, ellipseData.radiusX, ellipseData.radiusY),
          ),
        });
      }
    }
    return result;
  }

  getById(id: Id): Geometry | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined') {
      if (isPolygon(g)) return g;
      return g;
    }
    return null;
  }

  getByIdWithComponent<C extends {}>(id: Id, component: { key: keyof C }): Geometry<C> | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined' && component.key in g.components) {
      return g as Geometry<C>;
    }
    return null;
  }

  getByIdWithComponents<A extends {}, B extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
  ): Geometry<A & B> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
  ): Geometry<A & B & C> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
    d: { readonly key: keyof D },
  ): Geometry<A & B & C & D> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c?: { readonly key: keyof C },
    d?: { readonly key: keyof D },
  ): Geometry | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined') {
      if (
        a.key in g.components &&
        b.key in g.components &&
        (!c || (c.key as string) in g.components) &&
        (!d || (d.key as string) in g.components)
      ) {
        return g;
      }
    }
    return null;
  }

  /**
   * Adds a new geometry entry to the internal store.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addDirect(geometry: Geometry): void {
    this.geometryById.set(geometry.id, geometry);
    this.dcelIndex.addGeometry(geometry);
    this.emit('geometryAdded', geometry);

    if (Geometry.hasComponent(geometry, RectangleComponent)) {
      this.emit('rectanglesChanged', this.rectangles);
      this.emit('rectangleAdded', geometry as Rectangle);
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      this.emit('ellipsesChanged', this.ellipses);
      this.emit('ellipseAdded', geometry as Ellipse);
    } else if (Geometry.hasComponent(geometry, PolygonComponent)) {
      this.emit('polygonsChanged', this.polygons);
      this.emit('polygonAdded', geometry as Polygon);
    }
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
    this._debouncedDcelUpdaters.clear();
  }

  /** Sets the fill color of a Geometry<FillColorComponent>. Does NOT record to history - use setFillColor for that.
   * Internal version used by HistoryManager. */
  setFillColorDirect(id: Id, color: number | null): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, FillColorComponent)) {
      return;
    }

    const updated = FillColorComponent.update(geometry, color);
    console.log('UPDATED', updated, color);
    this.geometryById.set(id, updated);
    this.emit('geometryUpdated', updated);

    if (Geometry.hasComponent(updated, RectangleComponent)) {
      this.emit('rectanglesChanged', this.rectangles);
    } else if (Geometry.hasComponent(updated, EllipseComponent)) {
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

    if (Geometry.hasComponent(geometry, RectangleComponent)) {
      this.historyManager.apply(UndoEntry.rectangleFillColor(id, beforeColor, color));
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
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

    if (Geometry.hasComponent(updated, RectangleComponent)) {
      this.emit('rectanglesChanged', this.rectangles);
    } else if (Geometry.hasComponent(updated, EllipseComponent)) {
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

    if (Geometry.hasComponent(geometry, RectangleComponent)) {
      this.historyManager.apply(UndoEntry.rectangleRenderOrder(id, beforeOrder, order));
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      this.historyManager.apply(UndoEntry.ellipseRenderOrder(id, beforeOrder, order));
    } else if (isPolygon(geometry)) {
      this.historyManager.apply(UndoEntry.polygonRenderOrder(id, beforeOrder, order));
    }
  }

  /** Sets the linkDimensions flag of a {@link Geometry. Does NOT record to history - use setLinkDimensions for that.
   * Internal version used by HistoryManager. */
  setLinkDimensionsDirect(id: Id, link: boolean): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, LinkDimensionsComponent)) {
      return;
    }
    const updated = LinkDimensionsComponent.update(geometry, link);
    this.geometryById.set(id, updated);
    this.emit('geometryUpdated', updated);

    if (Geometry.hasComponent(updated, RectangleComponent)) {
      this.emit('rectanglesChanged', this.rectangles);
    } else if (Geometry.hasComponent(updated, EllipseComponent)) {
      this.emit('ellipsesChanged', this.ellipses);
    } else if (isPolygon(updated)) {
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /** Sets the linkDimensions flag of a {@link Geometry}, recording the change to history. */
  setLinkDimensions(id: Id, link: boolean): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, LinkDimensionsComponent)) {
      return;
    }

    const beforeLink = LinkDimensionsComponent.get(geometry);
    if (beforeLink === link) {
      return;
    }

    if (Geometry.hasComponent(geometry, RectangleComponent)) {
      this.historyManager.apply(UndoEntry.rectangleLinkDimensions(id, beforeLink, link));
    } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
      this.historyManager.apply(UndoEntry.ellipseLinkDimensions(id, beforeLink, link));
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
    this.dcelIndex.addGeometry(polygon);
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
      const points = PolygonComponent.get(g).points;
      const index = points.findIndex((seg) => seg.point.x === point.x && seg.point.y === point.y);
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
      const points = PolygonComponent.get(g).points;
      for (let i = 0; i < points.length; i++) {
        const seg = points[i];
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

    const beforePolygon = PolygonComponent.get(before);
    const afterPolygon = PolygonComponent.get(after);
    if (beforePolygon.points !== afterPolygon.points) {
      this._syncDcelUpdate(after);
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

    const beforePolygon = PolygonComponent.get(before);
    const afterPolygon = PolygonComponent.get(after);
    if (afterPolygon.points !== beforePolygon.points) {
      this.historyManager.push(
        UndoEntry.polygonMove(id, beforePolygon.points, afterPolygon.points),
      );
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
    this.dcelIndex.removeGeometry(id);

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

    const polygonData = PolygonComponent.get(polygon);
    const beforeSegments = polygonData.points.slice();

    const segment = polygonData.points[segmentIndex];
    const nextSegment = polygonData.points[segmentIndex + 1];

    if (!segment || !nextSegment) {
      return;
    }

    if (nextSegment.type !== 'point') {
      return;
    }

    const newSegment: PointSegment = { type: 'point', point: newPoint };
    const afterSegments = [
      ...polygonData.points.slice(0, segmentIndex + 1),
      newSegment,
      ...polygonData.points.slice(segmentIndex + 1),
    ];

    this.updatePolygonDirect(polygonId, (old) =>
      PolygonComponent.update(old, {
        points: afterSegments,
      }),
    );
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

    const polygonData = PolygonComponent.get(polygon);
    const beforeSegments = polygonData.points.slice();

    const pointSegment = polygonData.points[segmentIndex];
    const arcSegment = polygonData.points[segmentIndex + 1];

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
      ...polygonData.points.slice(0, segmentIndex + 1),
      leftArcSegment,
      rightArcSegment,
      ...polygonData.points.slice(segmentIndex + 2),
    ];

    this.updatePolygonDirect(polygonId, (old) =>
      PolygonComponent.update(old, {
        points: afterSegments,
      }),
    );
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

    const polygonData = PolygonComponent.get(polygon);
    const beforeSegments = polygonData.points.slice();

    const pointSegment = polygonData.points[segmentIndex];
    const arcSegment = polygonData.points[segmentIndex + 1];

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
      ...polygonData.points.slice(0, segmentIndex + 1),
      leftArcSegment,
      rightArcSegment,
      ...polygonData.points.slice(segmentIndex + 2),
    ];

    this.updatePolygonDirect(polygonId, (old) =>
      PolygonComponent.update(old, {
        points: afterSegments,
      }),
    );
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

  /** Sets the openAtIndex of a polygon. Does NOT record to history - use setPolygonOpenAtIndex for that.
   * Internal version used by HistoryManager. Automatically bounds to valid range. */
  setPolygonOpenAtIndexDirect(id: Id, openAtIndex: number): void {
    this.updatePolygonDirect(id, (old) => PolygonComponent.update(old, { openAtIndex }));
  }

  /** Sets the openAtIndex of a polygon. Automatically bounds to valid range. */
  setPolygonOpenAtIndex(id: Id, index: number): void {
    const polygon = this.getPolygonById(id);
    if (!polygon) return;
    const polygonData = PolygonComponent.get(polygon);
    const boundedIndex = Math.max(0, Math.min(index, polygonData.points.length - 1));
    if (polygonData.openAtIndex === boundedIndex) return;
    const beforeIndex = polygonData.openAtIndex;
    this.historyManager.apply(UndoEntry.polygonOpenAtIndex(id, beforeIndex, boundedIndex));
  }

  /** Closes a polygon. Does NOT record to history - use closePolygon for that.
   * Internal version used by HistoryManager. */
  closePolygonDirect(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => PolygonComponent.closePath(polygon));
  }

  /** Closes a polygon, recording the change to history. */
  closePolygon(id: Id): void {
    const geometry = this.getByIdWithComponent(id, PolygonComponent);
    if (!geometry) {
      return;
    }
    const polygon = PolygonComponent.get(geometry);
    if (polygon.closed || polygon.points.length < 3) {
      return;
    }
    this.historyManager.apply(UndoEntry.polygonClose(id, false, true));
  }

  /** Opens a polygon. Does NOT record to history - use openPolygon for that.
   * Internal version used by HistoryManager. */
  openPolygonDirect(id: Id): void {
    this.updatePolygonDirect(id, (polygon) => PolygonComponent.openPath(polygon));
  }

  /** Opens a polygon, recording the change to history. */
  openPolygon(id: Id): void {
    const geometry = this.getByIdWithComponent(id, PolygonComponent);
    if (!geometry) {
      return;
    }
    const polygon = PolygonComponent.get(geometry);
    if (!polygon.closed || polygon.points.length < 3) {
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
    this.dcelIndex.addGeometry(rectangle);
    this.emit('rectanglesChanged', this.rectangles);
    this.emit('rectangleAdded', rectangle);
    this.emit('geometryAdded', rectangle);
  }

  getRectangleById(id: Id): Rectangle | null {
    const g = this.geometryById.get(id);
    return g && Geometry.hasComponent(g, RectangleComponent) ? (g as Rectangle) : null;
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

    const beforeRectangle = RectangleComponent.get(before);
    const afterRectangle = RectangleComponent.get(after);
    if (
      beforeRectangle.upperLeft !== afterRectangle.upperLeft ||
      beforeRectangle.lowerRight !== afterRectangle.lowerRight
    ) {
      this._syncDcelUpdate(after);
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

    const beforeRectangle = RectangleComponent.get(before);
    const afterRectangle = RectangleComponent.get(after);
    if (
      afterRectangle.upperLeft !== beforeRectangle.upperLeft ||
      afterRectangle.lowerRight !== beforeRectangle.lowerRight
    ) {
      this.historyManager.apply(
        UndoEntry.rectangleMove(id, RectangleComponent.get(before), RectangleComponent.get(after)),
      );
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
    this.dcelIndex.removeGeometry(id);
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

  /** Takes the passed rectangle, deletes it, and converts it to a polygon. Records as a single
   * atomic conversion operation. */
  convertRectangleToPolygon(rectangleId: Id): Polygon {
    const geometry = this.getById(rectangleId);
    if (!geometry) {
      throw new Error(
        `GeometryStore.convertRectangleToPolygon: Cannot find rectangle ${rectangleId}`,
      );
    }
    if (
      !Geometry.hasComponents(
        geometry,
        RectangleComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      throw new Error(
        `GeometryStore.convertRectangleToPolygon: Cannot find rectangle ${rectangleId}`,
      );
    }
    const rectangle = RectangleComponent.get(geometry);
    const points = rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight);
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);

    const polygonTemplate = Polygon.create(points, {
      closed: true,
      fillColor: FillColorComponent.get(geometry),
      openAtIndex: 0,
    });
    const polygon: Polygon = {
      id,
      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(RenderOrderComponent.get(geometry)),
      },
    };

    this.addPolygonDirect(polygon);
    this.deleteRectangleDirect(rectangleId);
    this.historyManager.push(UndoEntry.rectangleToPolygon(geometry, polygon));
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
    this.dcelIndex.addGeometry(ellipse);
    this.emit('ellipsesChanged', this.ellipses);
    this.emit('ellipseAdded', ellipse);
    this.emit('geometryAdded', ellipse);
  }

  getEllipseById(id: Id): Ellipse | null {
    const g = this.geometryById.get(id);
    return g && Geometry.hasComponent(g, EllipseComponent) ? (g as Ellipse) : null;
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

    const beforeEllipse = EllipseComponent.get(before);
    const afterEllipse = EllipseComponent.get(after);
    if (
      beforeEllipse.center !== afterEllipse.center ||
      beforeEllipse.radiusX !== afterEllipse.radiusX ||
      beforeEllipse.radiusY !== afterEllipse.radiusY
    ) {
      this._syncDcelUpdate(after);
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
    const beforeEllipse = EllipseComponent.get(before);
    const afterEllipse = EllipseComponent.get(after);
    if (
      afterEllipse.center !== beforeEllipse.center ||
      afterEllipse.radiusX !== beforeEllipse.radiusX ||
      afterEllipse.radiusY !== beforeEllipse.radiusY
    ) {
      this.historyManager.apply(
        UndoEntry.ellipseMove(id, EllipseComponent.get(before), EllipseComponent.get(after)),
      );
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
    this.dcelIndex.removeGeometry(id);
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
    const ellipseData = EllipseComponent.get(ellipse);
    const points = ellipseToPolygon(ellipseData.center, ellipseData.radiusX, ellipseData.radiusY);
    const id = this.historyManager.generateStableId(ID_PREFIXES.polygon);

    const polygonTemplate = Polygon.create(points, {
      closed: true,
      fillColor: FillColorComponent.get(ellipse),
      openAtIndex: 0,
    });
    const polygon: Polygon = {
      id,
      ...polygonTemplate,
      components: {
        ...polygonTemplate.components,
        ...RenderOrderComponent.create(RenderOrderComponent.get(ellipse)),
      },
    };

    this.addPolygonDirect(polygon);
    this.deleteEllipseDirect(ellipseId);
    this.historyManager.push(UndoEntry.ellipseToPolygon(ellipse, polygon));
    return polygon;
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
        const corners = rectCorners(RectangleComponent.boundingBox(rect));
        return corners[endpoint.point];
      }
      case 'locked-ellipse': {
        const ellipse = this.getEllipseById(endpoint.id);
        if (!ellipse) {
          return null;
        }
        const points = ellipsePoints(EllipseComponent.get(ellipse));
        return points[endpoint.point];
      }
      case 'locked-polygon': {
        const polygon = this.getPolygonById(endpoint.id);
        if (!polygon) return null;
        const polygonData = PolygonComponent.get(polygon);
        if (endpoint.pointIndex >= polygonData.points.length) {
          return null;
        }
        return polygonData.points[endpoint.pointIndex].point;
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
              const polygonData = PolygonComponent.get(old);
              const points = polygonData.points.slice();
              for (const { update, position } of updates) {
                // FIXME: address typing, make shape update a proper enum
                points[(update as any).pointIndex] = {
                  ...points[(update as any).pointIndex],
                  point: position,
                };
              }
              return PolygonComponent.update(old, {
                points,
              });
            });
            touchedGeometries.set(id, 'polygon');
            break;

          case 'rectangle':
            this.updateRectangle(id, (old) => {
              let working = old;
              for (const { update, position } of updates) {
                switch (update.point) {
                  case 'upperLeft':
                    working = RectangleComponent.update(working, { upperLeft: position });
                    break;
                  case 'lowerRight':
                    working = RectangleComponent.update(working, { lowerRight: position });
                    break;
                  case 'upperRight': {
                    const workingRectangle = RectangleComponent.get(working);
                    const upperLeft = new SheetPosition(workingRectangle.upperLeft.x, position.y);
                    const lowerRight = new SheetPosition(position.x, workingRectangle.lowerRight.y);
                    working = RectangleComponent.update(working, { upperLeft, lowerRight });
                    break;
                  }
                  case 'lowerLeft': {
                    const workingRectangle = RectangleComponent.get(working);
                    const upperLeft = new SheetPosition(position.x, workingRectangle.upperLeft.y);
                    const lowerRight = new SheetPosition(workingRectangle.lowerRight.x, position.y);
                    working = RectangleComponent.update(working, { upperLeft, lowerRight });
                    break;
                  }
                }
              }
              return working;
            });
            touchedGeometries.set(id, 'rectangle');
            break;

          case 'ellipse':
            this.updateEllipse(id, (old) => {
              const ellipseData = EllipseComponent.get(old);
              // NOTE: the ordering here is really important.
              // The center has to be dealt with first
              // And then the perimeter positions subtracted from the up to date center
              //
              // If you subtract the perimeter positions against the out of date center, then the
              // results of the constraint cannot be expressed faithfully
              const foundCenter = updates.findLast((u) => u.update.point === 'center');
              const center = foundCenter ? foundCenter.position : ellipseData.center;

              let radiusX = ellipseData.radiusX;
              const foundLeft = updates.findLast((u) => u.update.point === 'left');
              if (foundLeft) {
                radiusX = center.x - foundLeft.position.x;
              }
              const foundRight = updates.findLast((u) => u.update.point === 'right');
              if (foundRight) {
                radiusX = foundRight.position.x - center.x;
              }

              let radiusY = ellipseData.radiusY;
              const foundTop = updates.findLast((u) => u.update.point === 'top');
              if (foundTop) {
                radiusY = center.y - foundTop.position.y;
              }
              const foundBottom = updates.findLast((u) => u.update.point === 'bottom');
              if (foundBottom) {
                radiusY = foundBottom.position.y - center.y;
              }

              return EllipseComponent.update(old, { center, radiusX, radiusY });
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
    for (const [id, _type] of touchedGeometries) {
      const geometry = this.getById(id);
      if (geometry) {
        this._syncDcelUpdate(geometry, true);
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
