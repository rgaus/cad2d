import EventEmitter from 'eventemitter3';
import debounce from 'lodash.debounce';
import {
  CONSTRAINT_SOLVER_MAX_ITERATIONS,
  CONSTRAINT_SOLVER_SUBSET_MAX_ITERATIONS,
  type EngineConstraint,
  type PointId,
  generatePositionsKeyOrder,
  getConflictingConstraints,
  getConstraintPointIds,
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
  LayoutState,
  LinkDimensionsComponent,
  PolygonComponent,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import {
  ColinearConstraint,
  ConstrainedTrack,
  ConstrainedTrackPath,
  Constraint,
  ConstraintEndpoint,
  ConstraintTemplate,
  HorizontalConstraint,
  LinearConstraint,
  ParallelConstraint,
  PerpendicularConstraint,
  VerticalConstraint,
} from '@/lib/geometry/constraints';
import { Ellipse } from '@/lib/geometry/ellipse';
import { Polygon, type PolygonSegment } from '@/lib/geometry/polygon';
import {
  WorkingConstraint,
  type WorkingDatum,
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
  workingDatumChanged: (wd: WorkingDatum | null) => void;
  constraintAdded: (constraint: Constraint) => void;
  constraintsChanged: (constraints: Array<Constraint>) => void;
  workingConstraintsChanged: (we: Array<WorkingConstraint>) => void;
};

export type GeometryAddOptions = {
  direct?: boolean;
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
  workingDatum: WorkingDatum | null = null;
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
   * Adds a new geometry, assigning it a a render order and stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addOrdered<C extends {}>(
    idPrefix: string,
    geometryTemplate: Omit<GeometryOmitComponents<Geometry<C>, RenderOrderComponent>, 'id'>,
    options: GeometryAddOptions & { renderOrder?: number } = {},
  ): Geometry<C & RenderOrderComponent> {
    const { renderOrder: optionsRenderOrder, ...restOptions } = options;
    const renderOrder = optionsRenderOrder ?? this.getMaxRenderOrder()[0] + 1;

    const templateWithRenderOrder: Omit<Geometry<C & RenderOrderComponent>, 'id'> = {
      ...geometryTemplate,
      components: {
        ...(geometryTemplate.components as C),
        ...RenderOrderComponent.create(renderOrder),
      },
    };

    return this.add(idPrefix, templateWithRenderOrder, restOptions);
  }

  /**
   * Adds a new geometry, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  add<C extends {}>(
    idPrefix: string,
    geometryTemplate: Omit<Geometry<C>, 'id'>,
    options: GeometryAddOptions = {},
  ): Geometry<C> {
    const id = this.historyManager.generateStableId(idPrefix);

    const fullGeometry: Geometry<C> = { ...geometryTemplate, id };

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

  /** Deletes a geometry by id, recording the deletion of the geometry and all
   *  attached constraints as a single atomic transaction. */
  deleteById(id: Id) {
    const geometry = this.getById(id);
    if (!geometry) {
      this.deleteConstraint(id);
      return;
    }

    this.historyManager.applyTransaction('delete-geometry-and-constraints', () => {
      // Record and delete attached constraints
      for (const constraint of this.findConstraintsByGeometryId(id)) {
        this.deleteConstraint(constraint.id);
      }
      // Record and delete the geometry
      this.historyManager.push(UndoEntry.deleteGeometry(geometry));
      this.deleteByIdDirect(id);
    });
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
        case 'horizontal':
          if (
            HorizontalConstraint.getPositionKeys()
              .map((key) => c[key])
              .find(matcher)
          ) {
            return true;
          }
          break;
        case 'vertical':
          if (
            VerticalConstraint.getPositionKeys()
              .map((key) => c[key])
              .find(matcher)
          ) {
            return true;
          }
          break;
        case 'colinear':
          if (
            ColinearConstraint.getPositionKeys()
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

    const polyData = PolygonComponent.get(polygon);
    const seg = polyData.points[segmentIndex];
    const nextSeg = polyData.points[segmentIndex + 1];
    if (!seg || !nextSeg || seg.type !== 'point' || nextSeg.type !== 'point') {
      return;
    }

    const constraints = this.findConstraintsByGeometryId(polygonId);

    this.historyManager.applyTransaction('polygon-insert-point-on-edge', () => {
      this.updateById(polygonId, (old) => {
        if (!Geometry.hasComponent(old, PolygonComponent)) {
          return old;
        }

        const result = PolygonComponent.addPointOnEdge(old, constraints, segmentIndex, {
          type: 'point',
          point: newPoint,
        });
        if (!result) {
          return old;
        }

        for (const event of result.updatedConstraintHistoryEvents) {
          this.historyManager.apply(event);
        }

        return result.geometry;
      });
    });
  }

  /**
   * Inserts a new point segment at the specified position on a quadratic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-quadratic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnQuadraticEdge(polygonId: Id, segmentIndex: number, t: number): void {
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const constraints = this.findConstraintsByGeometryId(polygonId);

    this.historyManager.applyTransaction('polygon-insert-point-on-edge', () => {
      this.updateById(polygonId, (old) => {
        if (!Geometry.hasComponent(old, PolygonComponent)) {
          return old;
        }

        const result = PolygonComponent.addPointOnEdge(old, constraints, segmentIndex, {
          type: 't',
          t,
        });
        if (!result) {
          return old;
        }

        for (const event of result.updatedConstraintHistoryEvents) {
          this.historyManager.apply(event);
        }

        return result.geometry;
      });
    });
  }

  /**
   * Inserts a new point segment at the specified position on a cubic arc edge,
   * splitting the arc at parameter t. The arc is defined by segmentIndex (point segment)
   * and segmentIndex+1 (arc-cubic segment).
   * Records the insertion to history for undo/redo.
   */
  addPointOnCubicEdge(polygonId: Id, segmentIndex: number, t: number): void {
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const constraints = this.findConstraintsByGeometryId(polygonId);

    this.historyManager.applyTransaction('polygon-insert-point-on-edge', () => {
      this.updateById(polygonId, (old) => {
        if (!Geometry.hasComponent(old, PolygonComponent)) {
          return old;
        }

        const result = PolygonComponent.addPointOnEdge(old, constraints, segmentIndex, {
          type: 't',
          t,
        });
        if (!result) {
          return old;
        }

        for (const event of result.updatedConstraintHistoryEvents) {
          this.historyManager.apply(event);
        }

        return result.geometry;
      });
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
  convertRectangleToPolygon(rectangleId: Id, options?: { insertConstraints?: boolean }): Polygon {
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

    this.historyManager.applyTransaction(
      'polygon-to-rectangle',
      () => {
        this.historyManager.apply(UndoEntry.rectangleToPolygon(geometry, polygon));

        // Optionally add horizontal/vertical constraints for each edge (a rectangle has
        // top/bottom horizontal, left/right vertical)
        const insertConstraints = options?.insertConstraints ?? true;
        if (insertConstraints) {
          const constraintTemplates = [
            HorizontalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
            ),
            VerticalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
            ),
            HorizontalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
            ),
            VerticalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
            ),
          ];

          for (const template of constraintTemplates) {
            this.addConstraint(template);
          }
        }
      },
      { collapseIfSingle: true },
    );

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

  setWorkingDatum(wd: WorkingDatum | null): void {
    this.workingDatum = wd;
    this.emit('workingDatumChanged', wd);
  }

  clearWorkingDatum(): void {
    this.workingDatum = null;
    this.emit('workingDatumChanged', null);
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
  reconstrain(sheetUnit: UnitType, fixedPositions: Array<SheetPosition>, epsilon?: number) {
    let unsolvableConstraintIds: Set<Constraint['id']> = new Set();

    outer: while (true) {
      // Step 1: Get all constraints which are in conflict, ordered by how far out they are, and get
      //         their length
      const constraints = this.constraints.filter((constraint) => {
        return (
          !unsolvableConstraintIds.has(constraint.id) &&
          Constraint.isInConflict(
            constraint,
            (ep) => this.resolveConstraintEndpoint(ep)!,
            sheetUnit,
          )
        );
      });
      if (constraints.length === 0) {
        break;
      }

      // Step 2: Take the constraint furthest out and get all associated geometries.
      const activeConstraint = constraints[0];
      const geometries = this.listWithComponent(RenderOrderComponent).filter((geometry) =>
        Constraint.isGeometryLockedTo(activeConstraint, geometry.id),
      );

      // Step 3: Find the geometry this constraint is attached to which has fewest constraints
      let movingGeometry: Geometry<RenderOrderComponent> | null = null;
      let movingGeometryConstraints: Array<Constraint> = [];
      for (const geometry of geometries) {
        const result = this.constraints.filter((constraint) =>
          Constraint.isGeometryLockedTo(constraint, geometry.id),
        );
        if (movingGeometry === null || result.length < movingGeometryConstraints.length) {
          movingGeometry = geometry;
          movingGeometryConstraints = result;
        }
      }
      if (!movingGeometry) {
        throw new Error('movingGeometry is null');
      }
      /** The position of movingGeometry where the constraint is attached. */
      let constraintMovingGeometryEndpoint: ConstraintEndpoint | null = null;
      for (const key of Constraint.getPositionKeys(activeConstraint)) {
        const ep = (activeConstraint as any)[key] as ConstraintEndpoint;
        if (ep.type !== 'point' && ep.id === movingGeometry.id) {
          constraintMovingGeometryEndpoint = ep;
          break;
        }
      }
      if (!constraintMovingGeometryEndpoint) {
        throw new Error('constraintMovingGeometryEndpoint is null');
      }

      // Step 4: Compute constrained tracks that `movingGeometry` can be on to make all constraints
      // not in conflict
      const tracks: Array<ConstrainedTrack> = [];
      for (const c of movingGeometryConstraints) {
        const built = Constraint.buildSingleConstrainedTrack(
          c,
          movingGeometry.id,
          sheetUnit,
          (ep) => this.resolveConstraintEndpoint(ep),
        );
        if (!built) {
          continue;
        }
        tracks.push(built.track);
      }

      // Step 5: Combine all constrained tracks for each constraint together
      let combinedTrackPath: Array<ConstrainedTrack> = [];
      if (tracks.length > 0) {
        combinedTrackPath.push(tracks[0]);
        for (let i = 1; i < tracks.length; i += 1) {
          const next: Array<ConstrainedTrack> = [];
          for (const existing of combinedTrackPath) {
            const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i], epsilon);
            if (intersection === 'immobile') {
              continue;
            }
            next.push(...intersection);
          }
          if (next.length === 0) {
            // Constrained track is immovable, there are no valid solutions
            // So skip this one and move on to the next constraint
            unsolvableConstraintIds.add(activeConstraint.id);
            continue outer;
          }
          combinedTrackPath = next;
        }
      }

      // Step 6: Find the closest solution on the point
      const currentEndpointPos = this.resolveConstraintEndpoint(constraintMovingGeometryEndpoint)!;
      const constrainedPoint = ConstrainedTrack.closestPointOnTracks(
        combinedTrackPath,
        currentEndpointPos,
      );
      if (!constrainedPoint) {
        // Cannot find a valid point
        // So skip this one and move on to the next constraint
        unsolvableConstraintIds.add(activeConstraint.id);
        continue;
      }

      // Step 7: Move `movingGeometry` so that the given constraint endpoint
      // `constraintMovingGeometryEndpoint` is located at `constrainedPoint`.
      const dx = constrainedPoint.x - currentEndpointPos.x;
      const dy = constrainedPoint.y - currentEndpointPos.y;
      const state = Geometry.getLayoutState(movingGeometry);
      if (state) {
        const newState = LayoutState.translate(state, (oldPoint) => {
          return new SheetPosition(oldPoint.x + dx, oldPoint.y + dy);
        });
        this.updateById(movingGeometry.id, (geometry) => {
          return Geometry.setLayoutState(geometry, newState);
        });
      }
    }

    console.log('UNSOLVABLE', unsolvableConstraintIds);
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
