import EventEmitter from 'eventemitter3';
import debounce from 'lodash.debounce';
import {
  CONSTRAINT_SOLVER_MAX_ITERATIONS,
  CONSTRAINT_SOLVER_SUBSET_MAX_ITERATIONS,
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
  WorkingConstraint,
  type WorkingDatum,
  type WorkingEllipse,
  WorkingFilter,
  type WorkingPolygon,
  type WorkingRectangle,
} from '@/lib/tools/types';
import { VertexId } from '../dcel';
import { HistoryManager } from '../history/HistoryManager';
import { UndoEntry } from '../history/types';
import { ellipseToPolygon, rectangleToPolygon } from '../math';
import { UnitType } from '../units/length';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '../viewport/types';
import { DCELShapeIndex } from './DCELShapeIndex';
import { FilterComponent } from './components/FilterComponent';
import {
  Constraint,
  ConstraintEndpoint,
  HorizontalConstraint,
  VerticalConstraint,
} from './constraints';
import { Ellipse } from './ellipse';
import {
  ConstraintComponent,
  DatumComponent,
  EllipseComponent,
  Entity,
  EntityOmitComponents,
  FillColorComponent,
  type Id,
  LinkDimensionsComponent,
  PolygonComponent,
  type Rectangle,
  RectangleComponent,
  RectangleEndpoint,
  RenderOrderComponent,
} from './index';
import { Polygon, type PolygonSegment } from './polygon';

export const ID_PREFIXES = {
  polygon: 'ply' as const,
  rectangle: 'rct' as const,
  ellipse: 'elp' as const,
  constraint: 'cns' as const,
  filter: 'ftr' as const,
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
  geometryAdded: (geometry: Entity) => void;
  geometryUpdated: (geometry: Entity) => void;
  geometryDeleted: (geometryId: Entity['id']) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
  workingRectangleChanged: (wr: WorkingRectangle | null) => void;
  workingEllipseChanged: (we: WorkingEllipse | null) => void;
  workingDatumChanged: (wd: WorkingDatum | null) => void;
  workingConstraintsChanged: (we: Array<WorkingConstraint>) => void;
  workingFilterChanged: (wd: WorkingFilter | null) => void;
};

export type GeometryAddOptions = {
  direct?: boolean;
};

/**
 * Stores all completed geometry (polygons, rectangles, ellipses) and the currently-drawn working shapes.
 * All mutating operations are recorded to the HistoryManager for undo/redo.
 */
export class GeometryStore extends EventEmitter<GeometryStoreEvents> {
  private geometryById = new Map<Id, Entity>();

  workingPolygon: WorkingPolygon | null = null;
  workingRectangle: WorkingRectangle | null = null;
  workingEllipse: WorkingEllipse | null = null;
  workingDatum: WorkingDatum | null = null;
  workingConstraints: Array<WorkingConstraint> = [];
  workingFilter: WorkingFilter | null = null;

  dcelIndex = new DCELShapeIndex();

  /**
   * Per-shape-ID debounced DCEL index updaters.  During rapid geometry
   * changes (e.g. dragging a shape) each shape's DCEL update is deferred
   * until 200 ms after its last mutation, keeping the hot path fast while
   * maintaining eventual consistency.
   */
  private _debouncedDcelUpdaters = new Map<Id, ReturnType<typeof debounce>>();
  private _syncDcelUpdate(geometry: Entity, immediate?: boolean): void {
    const id = geometry.id;
    if (immediate) {
      this.dcelIndex.updateGeometry(geometry);
      this._debouncedDcelUpdaters.delete(id);
      return;
    }

    let updater = this._debouncedDcelUpdaters.get(id);
    if (typeof updater === 'undefined') {
      updater = debounce((g: Entity) => {
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
    return ids;
  }

  /** Returns the Ids of all geometry items */
  hasId(id: Id): boolean {
    if (this.geometryById.has(id)) {
      return true;
    }
    return false;
  }

  listWithComponent<C extends {}>(component: { key: keyof C }): Array<Entity<C>> {
    const result: Array<Entity<C>> = [];
    for (const geometry of this.geometryById.values()) {
      if (Entity.hasComponent(geometry, component)) {
        result.push(geometry as Entity<C>);
      }
    }
    return result;
  }

  listWithComponents<A extends {}, B extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
  ): Array<Entity<A & B>>;
  listWithComponents<A extends {}, B extends {}, C extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
  ): Array<Entity<A & B & C>>;
  listWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
  ): Array<Entity<A & B & C & D>>;
  listWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c?: { key: keyof C },
    d?: { key: keyof D },
  ): Array<Entity> {
    const result: Array<Entity> = [];
    for (const geometry of this.geometryById.values()) {
      if (
        Entity.hasComponent(geometry, a) &&
        Entity.hasComponent(geometry, b) &&
        (!c || Entity.hasComponent(geometry, c)) &&
        (!d || Entity.hasComponent(geometry, d))
      ) {
        result.push(geometry);
      }
    }
    return result;
  }

  listWithOneOfComponents<A extends {}, B extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
  ): Array<Entity<A & B>>;
  listWithOneOfComponents<A extends {}, B extends {}, C extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
  ): Array<Entity<A & B & C>>;
  listWithOneOfComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
  ): Array<Entity<A & B & C & D>>;
  listWithOneOfComponents<A extends {}, B extends {}, C extends {}, D extends {}, E extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c: { key: keyof C },
    d: { key: keyof D },
    e: { key: keyof E },
  ): Array<Entity<A & B & C & D & E>>;
  listWithOneOfComponents<A extends {}, B extends {}, C extends {}, D extends {}, E extends {}>(
    a: { key: keyof A },
    b: { key: keyof B },
    c?: { key: keyof C },
    d?: { key: keyof D },
    e?: { key: keyof E },
  ): Array<Entity> {
    const result: Array<Entity> = [];
    for (const geometry of this.geometryById.values()) {
      if (
        Entity.hasComponent(geometry, a) ||
        Entity.hasComponent(geometry, b) ||
        (c && Entity.hasComponent(geometry, c)) ||
        (d && Entity.hasComponent(geometry, d)) ||
        (e && Entity.hasComponent(geometry, e))
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
      if (Entity.hasComponent(g, PolygonComponent)) {
        result.push({
          type: 'polygon',
          id: g.id,
          segments: pointsToSegments(PolygonComponent.get(g).points),
        });
      } else if (Entity.hasComponent(g, RectangleComponent)) {
        const rectangle = RectangleComponent.get(g);
        result.push({
          type: 'rectangle',
          id: g.id,
          segments: pointsToSegments(rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight)),
        });
      } else if (Entity.hasComponent(g, EllipseComponent)) {
        const ellipseData = EllipseComponent.get(g);
        result.push({
          type: 'ellipse',
          id: g.id,
          segments: pointsToSegments(
            ellipseToPolygon(ellipseData.center, ellipseData.radiusX, ellipseData.radiusY),
          ),
        });
      } else if (Entity.hasComponent(g, DatumComponent)) {
        result.push({ type: 'datum', id: g.id, segments: [] });
      }
    }
    return result;
  }

  getById(id: Id): Entity | null {
    return this.geometryById.get(id) ?? null;
  }

  *getByIds(ids: Array<Id>): Generator<Entity> {
    for (const geometry of this.geometryById.values()) {
      if (!ids.includes(geometry.id)) {
        continue;
      }
      yield geometry;
    }
  }

  getByIdWithComponent<C extends {}>(id: Id, component: { key: keyof C }): Entity<C> | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined' && component.key in g.components) {
      return g as Entity<C>;
    }
    return null;
  }

  *getByIdsWithComponent<C extends {}>(
    ids: Array<Id>,
    component: { key: keyof C },
  ): Generator<Entity<C>> {
    for (const geometry of this.geometryById.values()) {
      if (!ids.includes(geometry.id)) {
        continue;
      }
      if (!Entity.hasComponent(geometry, component)) {
        continue;
      }
      yield geometry;
    }
  }

  /** Get a geometry by id which includes ALL of the passed components (ie, logical AND) */
  getByIdWithComponents<A extends {}, B extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
  ): Entity<A & B> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
  ): Entity<A & B & C> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
    d: { readonly key: keyof D },
  ): Entity<A & B & C & D> | null;
  getByIdWithComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c?: { readonly key: keyof C },
    d?: { readonly key: keyof D },
  ): Entity | null {
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

  /** Get a geometry by id which includes ANY of the passed components (ie, logical OR) */
  getByIdWithOneOfComponents<A extends {}, B extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
  ): Entity<A & B> | null;
  getByIdWithOneOfComponents<A extends {}, B extends {}, C extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
  ): Entity<A & B & C> | null;
  getByIdWithOneOfComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c: { readonly key: keyof C },
    d: { readonly key: keyof D },
  ): Entity<A & B & C & D> | null;
  getByIdWithOneOfComponents<A extends {}, B extends {}, C extends {}, D extends {}>(
    id: Id,
    a: { readonly key: keyof A },
    b: { readonly key: keyof B },
    c?: { readonly key: keyof C },
    d?: { readonly key: keyof D },
  ): Entity | null {
    const g = this.geometryById.get(id);
    if (typeof g !== 'undefined') {
      if (
        a.key in g.components ||
        b.key in g.components ||
        (c && (c.key as string) in g.components) ||
        (d && (d.key as string) in g.components)
      ) {
        return g;
      }
    }
    return null;
  }

  /** Returns a renderable geometry if one exists for the given it.
   * FIXME: this is TEMPORARY, get rid of this when all renderable geometries are unified into a
   * single component like constraints... */
  getRenderableGeometryById(id: Entity['id']) {
    return this.getByIdWithOneOfComponents(
      id,
      RectangleComponent,
      EllipseComponent,
      PolygonComponent,
      DatumComponent,
    );
  }
  /** Returns a renderable geometry if one exists for the given it.
   * FIXME: this is TEMPORARY, get rid of this when all renderable geometries are unified into a
   * single component like constraints... */
  listRenderableGeometries() {
    return this.listWithOneOfComponents(
      RectangleComponent,
      EllipseComponent,
      PolygonComponent,
      DatumComponent,
    );
  }

  /**
   * Adds a new geometry entry to the internal store.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addDirect(geometry: Entity): void {
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
    geometryTemplate: Omit<EntityOmitComponents<Entity<C>, RenderOrderComponent>, 'id'>,
    options: GeometryAddOptions & { renderOrder?: number } = {},
  ): Entity<C & RenderOrderComponent> {
    const { renderOrder: optionsRenderOrder, ...restOptions } = options;
    const renderOrder = optionsRenderOrder ?? this.getMaxRenderOrder()[0] + 1;

    const templateWithRenderOrder: Omit<Entity<C & RenderOrderComponent>, 'id'> = {
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
    geometryTemplate: Omit<Entity<C>, 'id'>,
    options: GeometryAddOptions = {},
  ): Entity<C> {
    const id = this.historyManager.generateStableId(idPrefix);

    const fullGeometry: Entity<C> = { ...geometryTemplate, id };

    if (options?.direct) {
      this.addDirect(fullGeometry);
    } else {
      this.historyManager.apply(UndoEntry.insert(fullGeometry));
    }
    return fullGeometry;
  }

  deleteByIdDirect(id: Entity['id']): void {
    const geometry = this.getById(id);
    if (!geometry) {
      return;
    }

    // Delete constraints attached to this geometry
    for (const constraintGeom of this.findConstraintsByGeometryId(id)) {
      this.deleteByIdDirect(constraintGeom.id);
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
      return;
    }

    this.historyManager.applyTransaction('delete-geometry-cascade', () => {
      // Record and cascade delete attached constraints
      for (const constraintGeom of this.findConstraintsByGeometryId(id)) {
        this.historyManager.push(UndoEntry.deleteGeometry(constraintGeom));
        this.deleteByIdDirect(constraintGeom.id);
      }

      // Record and cascade delete attached filters
      for (const filterGeom of this.listWithComponent(FilterComponent)) {
        const filter = FilterComponent.get(filterGeom);
        switch (filter.type) {
          case 'mirror':
            if (filter.geometryId === id) {
              this.historyManager.push(UndoEntry.deleteGeometry(filterGeom));
              this.deleteByIdDirect(filterGeom.id);
            }
            break;
          case 'fillet':
          case 'chamfer':
            break;
          default:
            filter satisfies never;
            break;
        }
      }

      // Record and delete the geometry
      this.historyManager.push(UndoEntry.deleteGeometry(geometry));
      this.deleteByIdDirect(id);
    });
  }

  /** Removes all geometry (polygons, rectangles, ellipses, constraints) from the store and resets the DCEL index. */
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
    updatesOrFn: Partial<Entity> | ((old: Entity) => Entity),
  ): [Entity, Entity] | null {
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
   * Automatically syncs DCEL when component data changes.
   */
  updateByIdWithComponent<C extends {}>(
    id: Id,
    component: { key: keyof C },
    updatesOrFn: ((old: Entity<C>) => Entity<C>) | Partial<Entity<C>>,
  ) {
    this.updateById(id, (old) => {
      if (!Entity.hasComponent(old, component)) {
        return old;
      }
      return typeof updatesOrFn === 'function' ? updatesOrFn(old) : { ...old, ...updatesOrFn };
    });
  }

  /**
   * Updates a geometry by id, narrowed to a specific component.
   * Does NOT record to history — use updateById for that.
   * Automatically syncs DCEL when component data changes.
   */
  updateByIdWithComponentDirect<C extends {}>(
    id: Id,
    component: { key: keyof C },
    updatesOrFn: ((old: Entity<C>) => Entity<C>) | Partial<Entity<C>>,
  ): [Entity<C>, Entity<C>] | null {
    const before = this.geometryById.get(id);
    if (typeof before === 'undefined' || !Entity.hasComponent(before, component)) {
      return null;
    }

    const typedBefore = before as Entity<C>;
    const after =
      typeof updatesOrFn === 'function'
        ? updatesOrFn(typedBefore)
        : ({ ...typedBefore, ...updatesOrFn } as Entity<C>);

    this.geometryById.set(id, after);
    this.emit('geometryUpdated', after);
    this._syncDcelUpdate(after);
    return [typedBefore, after];
  }

  /** Updates a geometry by id, recording the change to history.
   *  Automatically detects the geometry type and creates the appropriate UndoEntry. */
  updateById(id: Id, updatesOrFn: Partial<Entity> | ((old: Entity) => Entity)): void {
    const results = this.updateByIdDirect(id, updatesOrFn);
    if (!results) {
      return;
    }
    const [before, after] = results;

    if (Entity.hasComponent(before, PolygonComponent)) {
      const beforeData = PolygonComponent.get(before);
      const afterData = PolygonComponent.get(after as Entity<PolygonComponent>);
      if (afterData.points !== beforeData.points) {
        this.historyManager.push(UndoEntry.polygonMove(id, beforeData.points, afterData.points));
      }
    } else if (Entity.hasComponent(before, RectangleComponent)) {
      const beforeData = RectangleComponent.get(before);
      const afterData = RectangleComponent.get(after as Entity<RectangleComponent>);
      if (
        afterData.upperLeft !== beforeData.upperLeft ||
        afterData.lowerRight !== beforeData.lowerRight
      ) {
        this.historyManager.push(UndoEntry.rectangleMove(id, beforeData, afterData));
      }
    } else if (Entity.hasComponent(before, EllipseComponent)) {
      const beforeData = EllipseComponent.get(before);
      const afterData = EllipseComponent.get(after as Entity<EllipseComponent>);
      if (
        afterData.center !== beforeData.center ||
        afterData.radiusX !== beforeData.radiusX ||
        afterData.radiusY !== beforeData.radiusY
      ) {
        this.historyManager.push(UndoEntry.ellipseMove(id, beforeData, afterData));
      }
    } else if (Entity.hasComponent(before, DatumComponent)) {
      const beforeData = { position: DatumComponent.get(before) };
      const afterData = { position: DatumComponent.get(after as Entity<DatumComponent>) };
      this.historyManager.push(UndoEntry.datumMove(before.id, beforeData, afterData));
    }
  }

  /** Sets the fill color of a {@link Entity<FillColorComponent>}, recording the change to history. */
  setFillColor(id: Id, color: number | null): void {
    const geometry = this.getById(id);
    if (!geometry || !Entity.hasComponent(geometry, FillColorComponent)) {
      return;
    }

    const beforeColor = FillColorComponent.get(geometry);
    if (beforeColor === color) {
      return;
    }

    this.historyManager.apply(UndoEntry.fillColor(id, beforeColor, color));
  }

  /** Sets the render order of a {@link Entity<RenderOrderComponent>}, recording the change to history. */
  setRenderOrder(id: Id, order: number): void {
    const geometry = this.getById(id);
    if (!geometry || !Entity.hasComponent(geometry, RenderOrderComponent)) {
      return;
    }

    const beforeOrder = RenderOrderComponent.get(geometry);
    if (beforeOrder === order) {
      return;
    }

    this.historyManager.apply(UndoEntry.renderOrder(id, beforeOrder, order));
  }

  /** Sets the linkDimensions flag of a {@link Entity}, recording the change to history. */
  setLinkDimensions(id: Id, link: boolean): void {
    const geometry = this.getById(id);
    if (!geometry || !Entity.hasComponent(geometry, LinkDimensionsComponent)) {
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
      if (!Entity.hasComponent(g, PolygonComponent)) continue;
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
  findConstraintsByGeometryId(geometryId: Id): Array<Entity<ConstraintComponent>> {
    return this.listWithComponent(ConstraintComponent).filter((g) =>
      Constraint.isGeometryLockedTo(g, geometryId),
    );
  }

  getConstraintsWherePointMatches(
    matcher: (point: ConstraintEndpoint) => boolean,
  ): Array<Entity<ConstraintComponent>> {
    return this.listWithComponent(ConstraintComponent).filter((g) => {
      const keys = Constraint.getPositionKeys(g);
      return keys.some((key) => {
        const ep = Constraint.getEndpoint(g, key);
        if (ep && typeof ep === 'object' && 'type' in (ep as object)) {
          return matcher(ep);
        }
        return false;
      });
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
        if (!Entity.hasComponent(old, PolygonComponent)) {
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
        if (!Entity.hasComponent(old, PolygonComponent)) {
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
        if (!Entity.hasComponent(old, PolygonComponent)) {
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
      !Entity.hasComponents(
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
          this.add(
            ID_PREFIXES.constraint,
            HorizontalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
            ),
          );
          this.add(
            ID_PREFIXES.constraint,
            VerticalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 1),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
            ),
          );
          this.add(
            ID_PREFIXES.constraint,
            HorizontalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 2),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
            ),
          );
          this.add(
            ID_PREFIXES.constraint,
            VerticalConstraint.create(
              ConstraintEndpoint.lockedToPolygon(polygon.id, 3),
              ConstraintEndpoint.lockedToPolygon(polygon.id, 0),
            ),
          );
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

  setWorkingFilter(wf: WorkingFilter | null): void {
    this.workingFilter = wf;
    this.emit('workingFilterChanged', wf);
  }

  clearWorkingFilter(): void {
    this.workingFilter = null;
    this.emit('workingFilterChanged', null);
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

  // ==================== CONSTRAINT ENDPOINT RESOLUTION ====================

  /** Resolves a ConstraintEndpoint to a concrete SheetPosition.
   *  For locked endpoints, looks up the geometry by ID and extracts the requested point.
   *  Returns null if the referenced geometry no longer exists or the point index is out of range. */
  resolveConstraintEndpoint(endpoint: ConstraintEndpoint): SheetPosition | null {
    switch (endpoint.type) {
      case 'point':
        return endpoint.point;
      case 'locked-rectangle': {
        return this.resolveRectangleKeyPoint(endpoint.id, endpoint.point);
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
        return this.resolvePolygonKeyPoint(endpoint.id, endpoint.pointIndex);
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

  /** Resolves a rectangle id and an associated key point to a concrete SheetPosition */
  resolveRectangleKeyPoint(
    rectangleId: Rectangle['id'],
    endpoint: RectangleEndpoint,
  ): SheetPosition | null {
    const rect = this.getByIdWithComponent(rectangleId, RectangleComponent);
    if (!rect) {
      return null;
    }
    const kp = RectangleComponent.keyPoints(rect);
    // Check perimeter labels first
    const perimeterIdx = kp.perimeterLabels.indexOf(
      endpoint as (typeof kp.perimeterLabels)[number],
    );
    if (perimeterIdx !== -1) {
      return kp.perimeter[perimeterIdx];
    }
    // Check extras (e.g. topMiddle)
    if (endpoint in kp.extras) {
      return kp.extras[endpoint as keyof typeof kp.extras];
    }
    return null;
  }

  /** Resolves a polygon id and an associated key point index to a concrete SheetPosition */
  resolvePolygonKeyPoint(polygonId: Polygon['id'], pointIndex: number): SheetPosition | null {
    const polygon = this.getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return null;
    }
    const polygonData = PolygonComponent.get(polygon);
    if (pointIndex >= polygonData.points.length) {
      return null;
    }
    return polygonData.points[pointIndex].point;
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
      this.listWithComponent(ConstraintComponent),
      fixedPositions,
      sheetUnit,
    );
    console.log('Constraints:', engineConstraints);

    // Step 2: Iterative expansion solve.
    //
    // Start with only the point IDs referenced by violated constraints (plus all
    // fixed points). Solve this subset. If the merged result satisfies ALL
    // constraints, accept it. Otherwise, expand the active point set by one hop
    // through the constraint graph (add any point that shares a constraint with
    // an already-active point) and retry. Repeat until a solution is found or
    // all reachable points are included, at which point we fall back to the
    // full solve. This strategy prefers solutions that disturb the fewest
    // number of vertices.

    // Build the constraint adjacency graph — for every constraint, add edges
    const graph = new Map<PointId, Set<PointId>>();
    for (const c of engineConstraints) {
      const pids = getConstraintPointIds(c);
      for (const pid of pids) {
        let adj = graph.get(pid);
        if (typeof adj === 'undefined') {
          adj = new Set<PointId>();
          graph.set(pid, adj);
        }
        for (const other of pids) {
          if (other !== pid) {
            adj.add(other);
          }
        }
      }
    }

    const fixedConstraints = engineConstraints.filter((c) => c.type === 'fixedPoint');
    const movableConstraints = engineConstraints.filter((c) => c.type !== 'fixedPoint');
    const conflicting = getConflictingConstraints(movableConstraints, positions);

    let resultPositions: Map<PointId, SheetPosition>;
    let converged = true;
    let iterations = 0;
    let expansionLevel = 0;

    if (conflicting.length === 0) {
      resultPositions = new Map(positions);
    } else {
      // Seed: point IDs from conflicting constraints + all fixed-point IDs
      const seedPointIds = new Set<PointId>();
      for (const c of conflicting) {
        for (const pid of getConstraintPointIds(c)) {
          seedPointIds.add(pid);
        }
      }
      for (const c of fixedConstraints) {
        const pids = getConstraintPointIds(c);
        if (pids.length > 0) {
          seedPointIds.add(pids[0]);
        }
      }

      // Accumulators assigned inside the expansion loop
      let foundMerged: Map<PointId, SheetPosition> | null = null;
      let foundConverged = false;
      let foundIterations = 0;

      let activePointIds = new Set(seedPointIds);

      while (true) {
        // Build subset: every constraint whose point IDs are all in activePointIds
        const subsetConstraints = engineConstraints.filter((c) =>
          getConstraintPointIds(c).every((pid) => activePointIds.has(pid)),
        );

        const subsetPositions = new Map<PointId, SheetPosition>();
        for (const pid of activePointIds) {
          const pos = positions.get(pid);
          if (typeof pos !== 'undefined') {
            subsetPositions.set(pid, pos);
          }
        }

        const subsetKeyOrder = generatePositionsKeyOrder(subsetPositions);
        const subsetResult = gradientDescent(
          positionsToState(subsetKeyOrder, subsetPositions),
          (input) => getLoss(subsetConstraints, stateToPositions(subsetKeyOrder, input)),
          CONSTRAINT_SOLVER_SUBSET_MAX_ITERATIONS,
        );

        const subsetResultPositions = stateToPositions(subsetKeyOrder, subsetResult.input);
        const merged = new Map(positions);
        for (const [pid, pos] of subsetResultPositions) {
          merged.set(pid, pos);
        }

        if (!isInConflict(engineConstraints, merged)) {
          foundMerged = merged;
          foundConverged = subsetResult.converged;
          foundIterations = subsetResult.iterations;
          break;
        }

        // Expand by one hop through the constraint graph
        const nextSet = new Set(activePointIds);
        let expanded = false;
        for (const pid of activePointIds) {
          const neighbors = graph.get(pid);
          if (typeof neighbors !== 'undefined') {
            for (const neighbor of neighbors) {
              if (!nextSet.has(neighbor)) {
                nextSet.add(neighbor);
                expanded = true;
              }
            }
          }
        }

        if (!expanded) {
          break;
        }

        activePointIds = nextSet;
        expansionLevel += 1;
      }

      if (foundMerged !== null) {
        resultPositions = foundMerged;
        converged = foundConverged;
        iterations = foundIterations;
      } else {
        // Fully exhausted expansion — fall back to full solve
        const positionsKeyOrder = generatePositionsKeyOrder(positions);
        const fullResult = gradientDescent(
          positionsToState(positionsKeyOrder, positions),
          (input) => getLoss(engineConstraints, stateToPositions(positionsKeyOrder, input)),
          CONSTRAINT_SOLVER_MAX_ITERATIONS,
        );
        resultPositions = stateToPositions(positionsKeyOrder, fullResult.input);
        converged = fullResult.converged;
        iterations = fullResult.iterations;
      }
    }
    const inConflict = isInConflict(engineConstraints, resultPositions);

    console.log(
      'Expansions:',
      expansionLevel,
      'Converged?',
      converged,
      'Constraints in Conflict:',
      inConflict,
      'Iterations:',
      iterations,
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
            this.updateById(id, (old) => {
              if (!Entity.hasComponent(old, PolygonComponent)) {
                return old;
              }
              const polygonData = PolygonComponent.get(old);
              const points = polygonData.points.slice();
              for (const { update, position } of updates) {
                // FIXME: address typing, make shape update a proper enum
                points[(update as any).pointIndex] = {
                  ...points[(update as any).pointIndex],
                  point: position,
                };
              }
              // When the constraint solver moves the first vertex of a closed
              // polygon, the duplicate closing point at the end of the points
              // array must mirror the new position so the loop stays closed.
              if (polygonData.closed && points.length > 1) {
                points[points.length - 1] = {
                  ...points[points.length - 1],
                  point: points[0].point,
                };
              }
              return PolygonComponent.update(old, {
                points,
              });
            });
            touchedGeometries.set(id, 'polygon');
            break;

          case 'rectangle':
            this.updateById(id, (old) => {
              if (!Entity.hasComponent(old, RectangleComponent)) {
                return old;
              }
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
            this.updateById(id, (old) => {
              if (!Entity.hasComponent(old, EllipseComponent)) {
                return old;
              }
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
              this.updateById(singleUpdate.update.id, (old) => {
                if (!Entity.hasComponent(old, DatumComponent)) {
                  return old;
                }
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
      if (!Entity.hasComponent(g, RenderOrderComponent)) {
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
