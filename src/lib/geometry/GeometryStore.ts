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
  DatumComponent,
  EllipseComponent,
  FillColorComponent,
  Geometry,
  GeometryOmitComponents,
  type Id,
  LinkDimensionsComponent,
  PolygonComponent,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import {
  Constraint,
  ConstraintEndpoint,
  ConstraintTemplate,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
} from '@/lib/geometry/constraints';
import { Ellipse } from '@/lib/geometry/ellipse';
import { Polygon, type PolygonSegment } from '@/lib/geometry/polygon';
import {
  WorkingConstraint,
  type WorkingEllipse,
  type WorkingPolygon,
  type WorkingRectangle,
} from '@/lib/tools/types';
import { VertexId } from '../dcel';
import { HistoryManager } from '../history/HistoryManager';
import { UndoEntry } from '../history/types';
import { ellipseToPolygon, rectangleToPolygon } from '../math';
import { UnitType } from '../units/length';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';

export const ID_PREFIXES = {
  polygon: 'ply' as const,
  rectangle: 'rct' as const,
  ellipse: 'elp' as const,
  constraint: 'cns' as const,
  datum: 'dtm' as const,
};

export function getPrefixFromId(id: Id) {
  const rawPrefix = id.split('_')[0] as (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];
  if (Object.values(ID_PREFIXES).includes(rawPrefix)) {
    return rawPrefix;
  } else {
    return null;
  }
}

/** Events emitted by GeometryStore. */
export type GeometryStoreEvents = {
  geometryAdded: (geometry: Geometry) => void;
  geometryUpdated: (geometry: Geometry) => void;
  geometryDeleted: (geometryId: Geometry['id']) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
  workingRectangleChanged: (wr: WorkingRectangle | null) => void;
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

  /** Returns the Ids of all geometry items */
  hasId(id: Id): boolean {
    if (this.geometryById.has(id)) {
      return true;
    }
    if (this.constraints.find((c) => c.id === id)) {
      return true;
    }
    return false;
  }

  listWithComponent<C extends {}>(component: { key: keyof C }): Array<Geometry<C>> {
    const result: Array<Geometry<C>> = [];
    for (const geometry of this.geometryById.values()) {
      if (Geometry.hasComponent(geometry, component)) {
        result.push(geometry as Geometry<C>);
      }
    }
    return result;
  }

  listWithComponents<A extends {}, B extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
  ): Array<Geometry<A & B>>;
  listWithComponents<A extends {}, B extends {}, C extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
  ): Array<Geometry<A & B & C>>;
  listWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
  ): Array<Geometry<A & B & C & D>>;
  listWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c?: { key: keyof C },
    d?: { key: keyof D },
  ): Array<Geometry> {
    const result: Array<Geometry> = [];
    for (const geometry of this.geometryById.values()) {
      if (
        Geometry.hasComponent(geometry, a) &&
        Geometry.hasComponent(geometry, b) &&
        (!c || Geometry.hasComponent(geometry, c)) &&
        (!d || Geometry.hasComponent(geometry, d))
      ) {
        result.push(geometry);
      }
    }
    return result;
  }

  /** Returns all inner geometry items with volume (polygons, rectangles, ellipses, etc) converted
   * into polygon segments. Used for intersection detection among other things. */
  getAllGeometryAsSegments(): Array<{
    type: 'polygon' | 'rectangle' | 'ellipse' | 'datum';
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
      type: 'polygon' | 'rectangle' | 'ellipse' | 'datum';
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
      if (Geometry.hasComponent(g, PolygonComponent)) {
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
      } else if (Geometry.hasComponent(g, DatumComponent)) {
        result.push({ type: 'datum', id: g.id, segments: [] });
      }
    }
    return result;
  }

  getById(id: Id): Geometry | null {
    return this.geometryById.get(id) ?? null;
  }

  *getByIds(ids: Array<Id>): Generator<Geometry> {
    for (const geometry of this.geometryById.values()) {
      if (!ids.includes(geometry.id)) {
        continue;
      }
      yield geometry;
    }
  }

  getByIdWithComponent<C extends {}>(id: Id, component: { key: keyof C }): Geometry<C> | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined' && component.key in g.components) {
      return g as Geometry<C>;
    }
    return null;
  }

  *getByIdsWithComponent<C extends {}>(
    ids: Array<Id>,
    component: { key: keyof C },
  ): Generator<Geometry<C>> {
    for (const geometry of this.geometryById.values()) {
      if (!ids.includes(geometry.id)) {
        continue;
      }
      if (!Geometry.hasComponent(geometry, component)) {
        continue;
      }
      yield geometry;
    }
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
  }

  /**
   * Adds a new geometry, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  add<C extends {}>(
    idPrefix: string,
    geometryTemplate: Omit<GeometryOmitComponents<Geometry<C>, RenderOrderComponent>, 'id'>,
    options: { direct?: boolean } = {},
  ): Geometry<C & RenderOrderComponent> {
    const id = this.historyManager.generateStableId(idPrefix);
    const renderOrder = this.getMaxRenderOrder()[0] + 1;

    const fullGeometry: Geometry<C & RenderOrderComponent> = {
      ...geometryTemplate,
      id,
      components: {
        ...(geometryTemplate.components as C),
        ...RenderOrderComponent.create(renderOrder),
      },
    };

    if (options?.direct) {
      this.addDirect(fullGeometry);
    } else {
      this.historyManager.apply(UndoEntry.insert(fullGeometry));
    }
    return fullGeometry;
  }

  deleteByIdDirect(id: Geometry['id']): void {
    const geometry = this.getById(id);
    if (!geometry) {
      return;
    }

    // Delete constraints attached to this geometry
    for (const constraint of this.findConstraintsByGeometryId(id)) {
      this.deleteConstraintDirect(constraint.id);
    }

    this.geometryById.delete(id);
    this.dcelIndex.removeGeometry(id);
    this.emit('geometryDeleted', id);
  }

  /** Deletes a geometry by id, recording the deletion to history. */
  deleteById(id: Id) {
    const geometry = this.getById(id);
    if (!geometry) {
      this.deleteConstraint(id);
      return;
    }

    this.historyManager.apply(UndoEntry.deleteGeometry(geometry));
  }

  /** Removes all geometry (polygons, rectangles, ellipses) from the store and resets the DCEL index.
   *  Does NOT clear constraints. */
  clearAll(): void {
    this.geometryById.clear();
    this.dcelIndex = new DCELShapeIndex();
    this._debouncedDcelUpdaters.clear();
  }

  /**
   * Updates a geometry by id. Does NOT record to history - use updateById for that.
   * Internal version used by HistoryManager.
   */
  updateByIdDirect(
    id: Id,
    updatesOrFn: Partial<Geometry> | ((old: Geometry) => Geometry),
  ): [Geometry, Geometry] | null {
    const before = this.geometryById.get(id);
    if (typeof before === 'undefined') {
      return null;
    }

    const after =
      typeof updatesOrFn === 'function' ? updatesOrFn(before) : { ...before, ...updatesOrFn };

    this.geometryById.set(id, after);
    this.emit('geometryUpdated', after);
    this._syncDcelUpdate(after);
    return [before, after];
  }

  /**
   * Updates a geometry by id, narrowed to a specific component.
   * Does NOT record to history — use updateById for that.
   * Automatically syncs DCEL when component data changes.
   */
  updateByIdWithComponentDirect<C extends {}>(
    id: Id,
    component: { key: keyof C },
    updatesOrFn: ((old: Geometry<C>) => Geometry<C>) | Partial<Geometry<C>>,
  ): [Geometry<C>, Geometry<C>] | null {
    const before = this.geometryById.get(id);
    if (typeof before === 'undefined' || !Geometry.hasComponent(before, component)) {
      return null;
    }

    const typedBefore = before as Geometry<C>;
    const after =
      typeof updatesOrFn === 'function'
        ? updatesOrFn(typedBefore)
        : ({ ...typedBefore, ...updatesOrFn } as Geometry<C>);

    this.geometryById.set(id, after);
    this.emit('geometryUpdated', after);
    this._syncDcelUpdate(after);
    return [typedBefore, after];
  }

  /** Updates a geometry by id, recording the change to history.
   *  Automatically detects the geometry type and creates the appropriate UndoEntry. */
  updateById(id: Id, updatesOrFn: Partial<Geometry> | ((old: Geometry) => Geometry)): void {
    const results = this.updateByIdDirect(id, updatesOrFn);
    if (!results) {
      return;
    }
    const [before, after] = results;

    if (Geometry.hasComponent(before, PolygonComponent)) {
      const beforeData = PolygonComponent.get(before);
      const afterData = PolygonComponent.get(after as Geometry<PolygonComponent>);
      if (afterData.points !== beforeData.points) {
        this.historyManager.push(UndoEntry.polygonMove(id, beforeData.points, afterData.points));
      }
    } else if (Geometry.hasComponent(before, RectangleComponent)) {
      const beforeData = RectangleComponent.get(before);
      const afterData = RectangleComponent.get(after as Geometry<RectangleComponent>);
      if (
        afterData.upperLeft !== beforeData.upperLeft ||
        afterData.lowerRight !== beforeData.lowerRight
      ) {
        this.historyManager.push(UndoEntry.rectangleMove(id, beforeData, afterData));
      }
    } else if (Geometry.hasComponent(before, EllipseComponent)) {
      const beforeData = EllipseComponent.get(before);
      const afterData = EllipseComponent.get(after as Geometry<EllipseComponent>);
      if (
        afterData.center !== beforeData.center ||
        afterData.radiusX !== beforeData.radiusX ||
        afterData.radiusY !== beforeData.radiusY
      ) {
        this.historyManager.push(UndoEntry.ellipseMove(id, beforeData, afterData));
      }
    } else if (Geometry.hasComponent(before, DatumComponent)) {
      const beforeData = { position: DatumComponent.get(before) };
      const afterData = { position: DatumComponent.get(after as Geometry<DatumComponent>) };
      this.historyManager.push(UndoEntry.datumMove(before.id, beforeData, afterData));
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

    this.historyManager.apply(UndoEntry.fillColor(id, beforeColor, color));
  }

  /** Sets the render order of a {@link Geometry<RenderOrderComponent>}, recording the change to history. */
  setRenderOrder(id: Id, order: number): void {
    const geometry = this.getById(id);
    if (!geometry || !Geometry.hasComponent(geometry, RenderOrderComponent)) {
      return;
    }

    const beforeOrder = RenderOrderComponent.get(geometry);
    if (beforeOrder === order) {
      return;
    }

    this.historyManager.apply(UndoEntry.renderOrder(id, beforeOrder, order));
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

    this.historyManager.apply(UndoEntry.linkDimensions(id, beforeLink, link));
  }

  // ==================== POLYGON METHODS ====================

  /** Finds all point segments across all polygons that are at exactly the same position as the given point. */
  findMatchingPoints(
    point: SheetPosition,
    excludePolygonId?: Id,
  ): Array<{ polygonId: Id; segmentIndex: number }> {
    const matches: Array<{ polygonId: Id; segmentIndex: number }> = [];
    for (const g of this.geometryById.values()) {
      if (!Geometry.hasComponent(g, PolygonComponent)) continue;
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
    return this.constraints.filter((c) => Constraint.isGeometryLockedTo(c, geometryId));
  }

  getConstraintsWherePointMatches(
    matcher: (point: ConstraintEndpoint) => boolean,
  ): Array<Constraint> {
    return this.constraints.filter((c) => {
      switch (c.type) {
        case 'linear':
          if (
            LinearConstraint.getPositionKeys()
              .map((key) => c[key])
              .find(matcher)
          ) {
            return true;
          }
          break;
        case 'perpendicular':
          if (
            PerpendicularConstraint.getPositionKeys()
              .map((key) => c[key])
              .find(matcher)
          ) {
            return true;
          }
          break;
        case 'parallel':
          if (
            ParallelConstraint.getPositionKeys()
              .map((key) => c[key])
              .find(matcher)
          ) {
            return true;
          }
          break;
        default: {
          c satisfies never;
          break;
        }
      }
      return false;
    });
  }

  /**
   * Inserts a new point segment at the specified position, splitting the line segment edge
   * between segmentIndex and segmentIndex+1. Only works for point-type segments.
   * Records the insertion to history for undo/redo.
   */
  addPointOnLineSegmentEdge(polygonId: Id, segmentIndex: number, newPoint: SheetPosition): void {
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const polygonData = PolygonComponent.get(polygon);
    const beforeSegments = polygonData.points.slice();

    this.updateByIdWithComponentDirect(polygonId, PolygonComponent, (old) => {
      const afterPolygon = PolygonComponent.addPointOnEdge(old, segmentIndex, newPoint);
      if (!afterPolygon) {
        return old;
      } else {
        this.historyManager.push(
          UndoEntry.polygonInsertPoint(
            polygonId,
            segmentIndex,
            newPoint,
            beforeSegments,
            PolygonComponent.get(afterPolygon).points,
          ),
        );
        return afterPolygon;
      }
    });
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
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const beforeSegments = PolygonComponent.get(polygon).points.slice();

    this.updateByIdWithComponentDirect(polygonId, PolygonComponent, (old) => {
      const afterPolygon = PolygonComponent.addPointOnEdge(old, segmentIndex, newPoint, t);
      if (!afterPolygon) {
        return old;
      } else {
        this.historyManager.push(
          UndoEntry.polygonInsertPoint(
            polygonId,
            segmentIndex,
            newPoint,
            beforeSegments,
            PolygonComponent.get(afterPolygon).points,
          ),
        );
        return afterPolygon;
      }
    });
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
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const beforeSegments = PolygonComponent.get(polygon).points.slice();

    this.updateByIdWithComponentDirect(polygonId, PolygonComponent, (old) => {
      const afterPolygon = PolygonComponent.addPointOnEdge(old, segmentIndex, newPoint, t);
      if (!afterPolygon) {
        return old;
      } else {
        this.historyManager.push(
          UndoEntry.polygonInsertPoint(
            polygonId,
            segmentIndex,
            newPoint,
            beforeSegments,
            PolygonComponent.get(afterPolygon).points,
          ),
        );
        return afterPolygon;
      }
    });
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

  // ==================== RECTANGLE METHODS ====================

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

    // Add constraints for all corners
    const constraintTemplates = [
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
      ),
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
      ),
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 4),
      ),
      PerpendicularConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
        ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
      ),
    ];

    this.historyManager.applyTransaction('polygon-to-rectangle', () => {
      this.historyManager.apply(UndoEntry.rectangleToPolygon(geometry, polygon));
      for (const template of constraintTemplates) {
        this.addConstraint(template);
      }
    });
    return polygon;
  }

  // ==================== ELLIPSE METHODS ====================

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
    const ellipse = this.getByIdWithComponent(ellipseId, EllipseComponent) as Ellipse;
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

    this.addDirect(polygon);
    this.deleteByIdDirect(ellipseId);
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
    this.historyManager.apply(UndoEntry.constraintInsert(fullConstraint));
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
  updateConstraintDirect<C extends Constraint>(
    id: Id,
    updatesOrFn: Partial<C> | ((old: C) => C),
  ): void {
    const index = this.constraints.findIndex((e) => e.id === id);
    if (index < 0) {
      return;
    }

    const before = this.constraints[index] as C;
    let after: C;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.constraints[index] = after;
    this.emit('constraintsChanged', this.constraints.slice());
  }

  /** Updates an constraint by id, recording the change to history. */
  updateConstraint<C extends Constraint>(id: Id, updatesOrFn: Partial<C> | ((old: C) => C)): void {
    const index = this.constraints.findIndex((e) => e.id === id);
    if (index < 0) {
      return;
    }

    const before = this.constraints[index] as C;
    let after: C;
    if (typeof updatesOrFn === 'function') {
      after = updatesOrFn(before);
    } else {
      after = { ...before, ...updatesOrFn };
    }

    this.constraints[index] = after;

    if (LinearConstraint.isLinearConstraint(before) && LinearConstraint.isLinearConstraint(after)) {
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
    }

    if (
      PerpendicularConstraint.isPerpendicularConstraint(before) &&
      PerpendicularConstraint.isPerpendicularConstraint(after)
    ) {
      if (
        !ConstraintEndpoint.equal(before.pointA, after.pointA) ||
        !ConstraintEndpoint.equal(before.pointCenter, after.pointCenter) ||
        !ConstraintEndpoint.equal(before.pointB, after.pointB)
      ) {
        this.historyManager.push(
          UndoEntry.perpendicularConstraintMoveEndpoints(
            id,
            before.pointA,
            before.pointCenter,
            before.pointB,
            after.pointA,
            after.pointCenter,
            after.pointB,
          ),
        );
      }
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
        const rect = this.getByIdWithComponent(endpoint.id, RectangleComponent);
        if (!rect) {
          return null;
        }
        const kp = RectangleComponent.keyPoints(rect);
        // Check perimeter labels first
        const perimeterIdx = kp.perimeterLabels.indexOf(
          endpoint.point as (typeof kp.perimeterLabels)[number],
        );
        if (perimeterIdx !== -1) {
          return kp.perimeter[perimeterIdx];
        }
        // Check extras (e.g. topMiddle)
        if (endpoint.point in kp.extras) {
          return kp.extras[endpoint.point as keyof typeof kp.extras];
        }
        return null;
      }
      case 'locked-ellipse': {
        const ellipse = this.getByIdWithComponent(endpoint.id, EllipseComponent);
        if (!ellipse) {
          return null;
        }
        const kp = EllipseComponent.keyPoints(ellipse);
        // Check perimeter labels first
        const perimeterIdx = kp.perimeterLabels.indexOf(
          endpoint.point as (typeof kp.perimeterLabels)[number],
        );
        if (perimeterIdx !== -1) {
          return kp.perimeter[perimeterIdx];
        }
        // Check extras
        if (endpoint.point in kp.extras) {
          return kp.extras[endpoint.point as keyof typeof kp.extras];
        }
        return null;
      }
      case 'locked-polygon': {
        const polygon = this.getByIdWithComponent(endpoint.id, PolygonComponent);
        if (!polygon) return null;
        const polygonData = PolygonComponent.get(polygon);
        if (endpoint.pointIndex >= polygonData.points.length) {
          return null;
        }
        return polygonData.points[endpoint.pointIndex].point;
      }
      case 'locked-datum': {
        const datum = this.getByIdWithComponent(endpoint.id, DatumComponent);
        if (!datum) return null;
        return DatumComponent.get(datum);
      }
      default:
        endpoint satisfies never;
        throw new Error(
          `GeometryStore#resolveConstraintEndpoint: unexpected endpoint type ${(endpoint as any).type}`,
        );
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
      this.historyManager.apply(UndoEntry.constraintDelete(constraint));
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

      const touchedGeometries = new Map<Id, 'polygon' | 'ellipse' | 'rectangle' | 'datum'>();
      for (const [id, updates] of shapeUpdatesById) {
        switch (updates[0].update.type) {
          case 'polygon':
            this.updateByIdWithComponentDirect(id, PolygonComponent, (old) => {
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
            this.updateByIdWithComponentDirect(id, RectangleComponent, (old) => {
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
            this.updateByIdWithComponentDirect(id, EllipseComponent, (old) => {
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

          case 'datum':
            for (const singleUpdate of updates) {
              this.updateByIdWithComponentDirect(singleUpdate.update.id, DatumComponent, (old) => {
                return DatumComponent.update(old, singleUpdate.position);
              });
            }
            touchedGeometries.set(id, 'datum');
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

  // ==================== WORKING DATUM ====================

  // ==================== RENDER ORDER ====================

  /** Returns the maximum render order across all geometry and the number of geometries at that max, or 0 if no geometry exists. */
  getMaxRenderOrder(): [number, number] {
    let max = 0;
    let maxCount = 0;
    for (const g of this.geometryById.values()) {
      if (!Geometry.hasComponent(g, RenderOrderComponent)) {
        continue;
      }
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
