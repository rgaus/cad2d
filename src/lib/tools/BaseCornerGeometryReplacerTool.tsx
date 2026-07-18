import {
  ColinearConstraint,
  Constraint,
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  Entity,
  GeometryComponent,
  HorizontalConstraint,
  type Id,
  Polygon,
  VerticalConstraint,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilletFilter } from '@/lib/entity/filters';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { PolygonSegment } from '@/lib/entity/polygon';
import { type RectangleEndpoint } from '@/lib/entity/rectangle';
import { Vector2 } from '@/lib/math';
import { applyKeyPointSnapping } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';

export type CornerState =
  | {
      mode: 'rectangle';
      geometryId: Id;
      centerEndpoint: RectangleEndpoint;
      pointAEndpoint: RectangleEndpoint;
      pointBEndpoint: RectangleEndpoint;
      centerPos: SheetPosition;
      pointAPos: SheetPosition;
      pointBPos: SheetPosition;
    }
  | {
      mode: 'polygon';
      geometryId: Id;
      centerIndex: number;
      pointAIndex: number;
      pointBIndex: number;
      centerPos: SheetPosition;
      pointAPos: SheetPosition;
      pointBPos: SheetPosition;
    };

export type CornerReplacementToolEvents = {
  currentOffsetChange: (data: { offset: Length | null; select: boolean }) => void;
  pendingCornerChange: (state: CornerState | null) => void;
  activeCornerChange: (state: CornerState | null) => void;
};

export type ResolveGeometryAndIndicesResults = {
  /** The ID of the polygon geometry being used. May differ from the input ID if a
   *  rectangle was converted to a polygon. */
  geometryId: Id;
  /** The resolved polygon geometry with PolygonComponent. */
  polygon: Entity<GeometryComponent<PolygonData>>;
  /** The raw polygon data (points array and closed flag) from PolygonComponent.get. */
  polygonData: PolygonData;
  /** Zero-based index of the center (corner) vertex in polygon.points. */
  centerIndex: number;
  /** Zero-based index of pointA (one adjacent vertex) in polygon.points. */
  pointAIndex: number;
  /** Zero-based index of pointB (other adjacent vertex) in polygon.points. */
  pointBIndex: number;
  /** ID of a newly created datum to which center-point constraints were migrated.
   *  Null if no constraints needed migration. */
  centerDatumId: Datum['id'] | null;
  /** True if pointA follows center in cyclic polygon order (mod n). Used to determine
   *  split direction and edge orientation. */
  pointAIsAfterCenter: boolean;
  /** True if pointB follows center in cyclic polygon order (mod n). Used to determine
   *  split direction and edge orientation. */
  pointBIsAfterCenter: boolean;
};

/**
 * Results from validateOffset: validates that the offset is smaller than both
 * edge lengths and pre-computes geometric values needed for splitting and segment construction.
 */
export type ValidateOffsetResults = {
  /** Sheet position of the center vertex. */
  centerPos: SheetPosition;
  /** Sheet position of pointA (far end of first edge). */
  pointAPos: SheetPosition;
  /** Sheet position of pointB (far end of second edge). */
  pointBPos: SheetPosition;
  /** Euclidean distance from center to pointA. */
  lenA: number;
  /** Euclidean distance from center to pointB. */
  lenB: number;
  /** The t parameter (0-1) along the center->pointA edge where the split occurs.
   *  Based on offset direction relative to pointAIsAfterCenter. */
  tA: number;
  /** The t parameter (0-1) along the center->pointB edge where the split occurs.
   *  Based on offset direction relative to pointBIsAfterCenter. */
  tB: number;
  /** The offset distance in sheet units. */
  offset: number;
};

/**
 * Results from splitEdgesAtOffset: inserts two new vertices on the polygon edges
 * at the offset distance from the center. Constraint history events are replayed
 * to maintain constraint integrity.
 */
type SplitEdgesAtOffsetResults = {
  /** The updated polygon geometry after both edge splits. */
  geometry: Entity<GeometryComponent<PolygonData>>;
  /** Sheet position where the first edge was split (center->pointA side). */
  splitAPos: SheetPosition;
  /** Sheet position where the second edge was split (center->pointB side). */
  splitBPos: SheetPosition;
  /** Index in the post-split polygon.points array of splitA. */
  splitAIdx: number;
  /** Index in the post-split polygon.points array of splitB. */
  splitBIdx: number;
  /** Index of the center vertex in the post-split polygon. */
  centerIdxFirst: number;
};

/**
 * Results from buildCornerSegment: the updated polygon geometry with the corner replacement
 * segment inserted and the index where it was added.
 */
type BuildCornerSegmentResults = {
  /** The updated polygon geometry with the corner segment inserted. */
  geometry: Entity<GeometryComponent<PolygonData>>;
  /** The index in polygon.points where the segment was inserted. Used by subsequent
   *  steps to skip over the segment when iterating perimeter points. */
  addedSegmentIndex: number;
};

/** For a rectangle, each corner's two adjacent corners are always the same two, so clicking
 * any corner identifies all three points without further clicks. Only the 4 perimeter corners
 * are included; extras like 'center' are omitted since corner replacement only makes sense at corners. */
const RECTANGLE_ADJACENCY: Partial<
  Record<RectangleEndpoint, [RectangleEndpoint, RectangleEndpoint]>
> = {
  upperLeft: ['lowerLeft', 'upperRight'],
  upperRight: ['lowerRight', 'upperLeft'],
  lowerRight: ['lowerLeft', 'upperRight'],
  lowerLeft: ['lowerRight', 'upperLeft'],
};

type CornerReplacementToolState =
  | { type: 'idle' }
  | {
      type: 'awaiting-distance';
      active: CornerState;
      currentOffset: Length | null;
    };

/**
 * Abstract base class for corner geometry replacement tools (fillet, chamfer, etc).
 *
 * UX flow for polygons:
 *  1. Click a corner vertex (key point on a polygon)
 *  2. The tool determines the two adjacent vertices automatically
 *  3. Enter the offset distance in a popup input
 *  4. The corner is replaced with a new polygon segment defined by the subclass
 *
 * Rectangle shortcut: clicking any rectangle corner jumps directly from step 1
 * to step 3, since the two adjacent corners are always unambiguous.
 */
export abstract class BaseCornerGeometryReplacerTool<Type extends string> extends BaseTool<
  CornerReplacementToolEvents,
  Type
> {
  private state: CornerReplacementToolState = { type: 'idle' };

  get currentOffset(): Length | null {
    if (this.state.type !== 'awaiting-distance') {
      return null;
    }
    return this.state.currentOffset;
  }
  onChangeCurrentOffset(offset: Length | null) {
    if (this.state.type !== 'awaiting-distance') {
      return;
    }
    this.state = { ...this.state, currentOffset: offset };
    this.emit('currentOffsetChange', { offset, select: false });
  }

  /** The last offset value committed by the user (via Enter or Accept button).
   *  Persists across corner operations so subsequent clicks can reuse it. */
  lastCommittedOffset: Length | null = null;

  protected defaultCursor = 'pointer';

  handleToolBlur(): void {
    this.state = { type: 'idle' };
    this.lastCommittedOffset = null;
    this.emit('pendingCornerChange', null);
    this.emit('activeCornerChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    let { endpoint: rawEndpoint } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        manager: this,
        viewportScale: viewport.scale,
        geometries: geometryStore.listWithComponent(GeometryComponent),
        constraints: geometryStore.listWithComponent(ConstraintComponent),
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    // Reject duplicate / invalid points
    switch (rawEndpoint.type) {
      case 'locked-rectangle':
        if (
          this.state.type === 'awaiting-distance' &&
          this.state.active.mode === 'rectangle' &&
          this.state.active.geometryId === rawEndpoint.id &&
          this.state.active.centerEndpoint === rawEndpoint.point
        ) {
          // The click was on the same endpoint that is already active,
          // so do nothing
          return;
        }
        break;
      case 'locked-polygon':
        if (
          this.state.type === 'awaiting-distance' &&
          this.state.active.mode === 'polygon' &&
          this.state.active.geometryId === rawEndpoint.id &&
          this.state.active.centerIndex === rawEndpoint.pointIndex
        ) {
          // The click was on the same endpoint that is already active,
          // so do nothing
          return;
        }
        break;
      case 'point':
        // Point endpoints are meaningless in this context.
        return;
      default:
        // Other geometries don't really make sense to apply a corner replacement to
        // So ignore them.
        break;
    }

    // Commit any in flight corner decoration before continuing
    if (this.state.type === 'awaiting-distance') {
      const lastEndpoint = this.state.active;

      // Look up the rectangle BEFORE commit destroys it via conversion to polygon
      // in processCornerReplacement.
      const rawEndpointRectangleGeometry =
        rawEndpoint.type === 'locked-rectangle'
          ? (this.getGeometryStore().getByIdWithComponent(
              rawEndpoint.id,
              GeometryComponent,
            ) as Entity<GeometryComponent<RectangleData>>)
          : null;

      const result = this.commit();

      // Map from rectangle key points to new polygon key points
      if (
        result &&
        lastEndpoint.mode === 'rectangle' &&
        rawEndpoint.type === 'locked-rectangle' &&
        rawEndpointRectangleGeometry
      ) {
        rawEndpoint = this.convertRectangleCornerToPolygonIndex(
          rawEndpointRectangleGeometry,
          rawEndpoint.point,
          result.outputPolygonId,
          lastEndpoint.centerEndpoint,
        );
      }
    }

    switch (rawEndpoint.type) {
      case 'locked-rectangle': {
        const pos = geometryStore.resolveConstraintEndpoint(rawEndpoint);
        const adjacencies = RECTANGLE_ADJACENCY[rawEndpoint.point as RectangleEndpoint];
        if (!pos || typeof adjacencies === 'undefined') {
          return;
        }
        const [labelA, labelB] = adjacencies;
        const posA = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(rawEndpoint.id, labelA),
        );
        const posB = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(rawEndpoint.id, labelB),
        );
        if (!posA || !posB) {
          return;
        }
        const active: CornerState = {
          mode: 'rectangle',
          geometryId: rawEndpoint.id,
          centerEndpoint: rawEndpoint.point,
          pointAEndpoint: labelA,
          pointBEndpoint: labelB,
          centerPos: pos,
          pointAPos: posA,
          pointBPos: posB,
        };
        this.state = { type: 'awaiting-distance', active, currentOffset: this.lastCommittedOffset };
        this.emit('currentOffsetChange', {
          offset: this.lastCommittedOffset,
          select: this.lastCommittedOffset !== null,
        });
        this.emit('activeCornerChange', active);
        return;
      }
      case 'locked-polygon': {
        const geometry = geometryStore.getByIdWithComponent(
          rawEndpoint.id,
          GeometryComponent,
        ) as Entity<GeometryComponent<PolygonData>>;
        if (!geometry) {
          return;
        }
        const polygon = GeometryComponent.get(geometry as Entity<GeometryComponent<PolygonData>>);

        let previousIndex = rawEndpoint.pointIndex - 1;
        while (previousIndex < 0) {
          previousIndex += polygon.points.length;
        }
        // Skip indices that are at the same position as the center (closing duplicate).
        const centerPoint = polygon.points[rawEndpoint.pointIndex].point;
        while (
          polygon.points[previousIndex].point.x === centerPoint.x &&
          polygon.points[previousIndex].point.y === centerPoint.y
        ) {
          previousIndex -= 1;
          while (previousIndex < 0) {
            previousIndex += polygon.points.length;
          }
        }
        let nextIndex = rawEndpoint.pointIndex + 1;
        while (nextIndex >= polygon.points.length) {
          nextIndex -= polygon.points.length;
        }
        while (
          polygon.points[nextIndex].point.x === centerPoint.x &&
          polygon.points[nextIndex].point.y === centerPoint.y
        ) {
          nextIndex += 1;
          while (nextIndex >= polygon.points.length) {
            nextIndex -= polygon.points.length;
          }
        }

        const pos = geometryStore.resolveConstraintEndpoint(rawEndpoint);
        if (!pos) {
          return;
        }

        const active: CornerState = {
          mode: 'polygon',
          geometryId: rawEndpoint.id,
          centerIndex: rawEndpoint.pointIndex,
          pointAIndex: previousIndex,
          pointBIndex: nextIndex,
          centerPos: pos,
          pointAPos: polygon.points[previousIndex].point,
          pointBPos: polygon.points[nextIndex].point,
        };
        this.state = { type: 'awaiting-distance', active, currentOffset: this.lastCommittedOffset };
        this.emit('currentOffsetChange', {
          offset: this.lastCommittedOffset,
          select: this.lastCommittedOffset !== null,
        });
        this.emit('activeCornerChange', active);
        return;
      }
      default:
        // Other geometries don't really make sense to apply a corner replacement to
        // So ignore them.
        break;
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const { endpoint: keyPointEndpoint } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        manager: this,
        viewportScale: viewport.scale,
        geometries: geometryStore.listWithComponent(GeometryComponent),
        constraints: geometryStore.listWithComponent(ConstraintComponent),
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    switch (keyPointEndpoint.type) {
      case 'locked-rectangle': {
        if (
          this.state.type === 'awaiting-distance' &&
          this.state.active.mode === 'rectangle' &&
          this.state.active.geometryId === keyPointEndpoint.id &&
          this.state.active.centerEndpoint === keyPointEndpoint.point
        ) {
          // Rectangle endpoint is the same as the active endpoint, so don't ALSO emit it as
          // pending. Pending is only for net new corners.
          this.emit('pendingCornerChange', null);
          return;
        }

        const centerPos = geometryStore.resolveConstraintEndpoint(keyPointEndpoint);
        const adjacencies = RECTANGLE_ADJACENCY[keyPointEndpoint.point as RectangleEndpoint];
        if (!centerPos || typeof adjacencies === 'undefined') {
          this.emit('pendingCornerChange', null);
          return;
        }
        const [labelA, labelB] = adjacencies;
        const posA = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(keyPointEndpoint.id, labelA),
        );
        const posB = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(keyPointEndpoint.id, labelB),
        );
        if (!posA || !posB) {
          this.emit('pendingCornerChange', null);
          return;
        }
        this.emit('pendingCornerChange', {
          mode: 'rectangle',
          geometryId: keyPointEndpoint.id,
          centerEndpoint: keyPointEndpoint.point,
          pointAEndpoint: labelA,
          pointBEndpoint: labelB,
          centerPos,
          pointAPos: posA,
          pointBPos: posB,
        });
        return;
      }
      case 'locked-polygon': {
        if (
          this.state.type === 'awaiting-distance' &&
          this.state.active.mode === 'polygon' &&
          this.state.active.geometryId === keyPointEndpoint.id &&
          this.state.active.centerIndex === keyPointEndpoint.pointIndex
        ) {
          // Polygon endpoint is the same as the active endpoint, so don't ALSO emit it as
          // pending. Pending is only for net new corners.
          this.emit('pendingCornerChange', null);
          return;
        }

        const geometry = geometryStore.getByIdWithComponent(
          keyPointEndpoint.id,
          GeometryComponent,
        ) as Entity<GeometryComponent<PolygonData>>;
        if (!geometry) {
          this.emit('pendingCornerChange', null);
          return;
        }
        const polygon = GeometryComponent.get(geometry as Entity<GeometryComponent<PolygonData>>);
        const centerPoint = polygon.points[keyPointEndpoint.pointIndex].point;

        let previousIndex = keyPointEndpoint.pointIndex - 1;
        while (previousIndex < 0) {
          previousIndex += polygon.points.length;
        }
        while (
          polygon.points[previousIndex].point.x === centerPoint.x &&
          polygon.points[previousIndex].point.y === centerPoint.y
        ) {
          previousIndex -= 1;
          while (previousIndex < 0) {
            previousIndex += polygon.points.length;
          }
        }

        let nextIndex = keyPointEndpoint.pointIndex + 1;
        while (nextIndex >= polygon.points.length) {
          nextIndex -= polygon.points.length;
        }
        while (
          polygon.points[nextIndex].point.x === centerPoint.x &&
          polygon.points[nextIndex].point.y === centerPoint.y
        ) {
          nextIndex += 1;
          while (nextIndex >= polygon.points.length) {
            nextIndex -= polygon.points.length;
          }
        }

        const centerPos = geometryStore.resolveConstraintEndpoint(keyPointEndpoint);
        if (!centerPos) {
          this.emit('pendingCornerChange', null);
          return;
        }

        const previous = polygon.points[previousIndex];
        const current = polygon.points[keyPointEndpoint.pointIndex];
        const next = polygon.points[nextIndex];
        if (current.type !== 'point' || next.type !== 'point') {
          // To add a corner decoration, it must be a corner made up of two line segments,
          // not an already existing curve.
          this.emit('pendingCornerChange', null);
          return;
        }

        this.emit('pendingCornerChange', {
          mode: 'polygon',
          geometryId: keyPointEndpoint.id,
          centerIndex: keyPointEndpoint.pointIndex,
          pointAIndex: previousIndex,
          pointBIndex: nextIndex,
          centerPos,
          pointAPos: previous.point,
          pointBPos: next.point,
        });
        return;
      }
      default:
        this.emit('pendingCornerChange', null);
        return;
    }
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abort();
      return true;
    }
    return false;
  }

  /**
   * Called by the React popup when the user confirms the offset distance.
   * Executes the full corner replacement operation inside a history transaction.
   */
  commit() {
    if (this.state.type !== 'awaiting-distance') {
      return;
    }
    if (this.state.currentOffset === null) {
      return;
    }
    const pending = this.state.active;
    const historyManager = this.getHistoryManager();
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const offset = this.state.currentOffset.toSheetUnits(sheet.defaultUnit).magnitude;
    const currentOffset = this.state.currentOffset;

    const filter =
      pending.mode === 'rectangle'
        ? FilletFilter.createOnRectangle(
            pending.geometryId,
            pending.pointAEndpoint,
            pending.centerEndpoint,
            pending.pointBEndpoint,
            currentOffset,
          )
        : FilletFilter.createOnPolygon(
            pending.geometryId,
            pending.pointAIndex,
            pending.centerIndex,
            pending.pointBIndex,
            currentOffset,
          );
    this.getGeometryStore().add(ID_PREFIXES.filter, filter);

    const result = historyManager.applyTransaction(this.type, () => {
      return this.processCornerReplacement(pending, offset);
    });

    this.lastCommittedOffset = this.state.currentOffset;
    this.abort();
    return result;
  }

  private abort(): void {
    this.state = { type: 'idle' };
    this.emit('pendingCornerChange', null);
    this.emit('activeCornerChange', null);
    this.emit('keyPointSnapChange', null);
  }

  /**
   * Converts a rectangle corner label to a locked-polygon endpoint using the
   * {@link RectangleComponent.keyPoints().perimeterLabels} ordering to determine the
   * base polygon point index. Accounts for a previously decorated corner that was
   * at an earlier position in the perimeter, which shifts the current corner's index
   * by +1.
   */
  private convertRectangleCornerToPolygonIndex(
    rectangle: Entity<GeometryComponent<RectangleData>>,
    cornerLabel: RectangleEndpoint,
    outputPolygonId: Id,
    previousDecoratedCorner: RectangleEndpoint,
  ): Extract<ConstraintEndpoint, { type: 'locked-polygon' }> {
    const perimeterLabels = GeometryComponent.keyPoints(
      rectangle as Entity<GeometryComponent<RectangleData>>,
    ).perimeterLabels;

    const baseIndex = perimeterLabels.indexOf(cornerLabel as (typeof perimeterLabels)[0]);
    const previousIndex = perimeterLabels.indexOf(
      previousDecoratedCorner as (typeof perimeterLabels)[0],
    );

    let offset = 0;
    if (previousIndex >= 0 && previousIndex < baseIndex) {
      offset += 1;
    }

    return {
      type: 'locked-polygon',
      id: outputPolygonId,
      pointIndex: baseIndex + offset,
    };
  }

  /** Executes the corner replacement operation. Must be called inside a history transaction. */
  private processCornerReplacement(
    pending: CornerState,
    offset: number,
  ): { outputPolygonId: Polygon['id'] } | null {
    const step1 = this.resolveGeometryAndIndices(pending);
    const step2 = this.validateOffset(step1, offset);
    if (!step2) {
      return null;
    }
    const step3 = this.splitEdgesAtOffset(step1, step2);
    const step4 = this.buildCornerSegment(step1, step2, step3);
    this.addColinearConstraints(step1, step2, step3);
    this.addRectilinearConstraints(step1, step4);
    return { outputPolygonId: step1.geometryId };
  }

  /**
   * Resolves the polygon geometry and computes the center/pointA/pointB indices, handling
   * both direct polygon selection and rectangle shortcut modes. Also migrates any existing
   * constraints attached to the center point to a new datum.
   */
  private resolveGeometryAndIndices(pending: CornerState): ResolveGeometryAndIndicesResults {
    const geometryStore = this.getGeometryStore();

    let geometryId = pending.geometryId;
    let geometry: Entity<GeometryComponent<PolygonData>>;
    let polygonData: PolygonData;
    let centerDatumId: Datum['id'] | null = null;
    let centerIndex: number = -1;
    let pointAIndex: number = -1;
    let pointBIndex: number = -1;
    let pointAIsAfterCenter: boolean;
    let pointBIsAfterCenter: boolean;
    switch (pending.mode) {
      case 'polygon': {
        const result = geometryStore.getByIdWithComponent(geometryId, GeometryComponent);
        if (!result || !GeometryComponent.isPolygon(result)) {
          throw new Error(
            'BaseCornerGeometryReplacerTool.resolveGeometryAndIndices: polygon not found',
          );
        }
        geometry = result;
        polygonData = GeometryComponent.get(geometry);

        centerIndex = pending.centerIndex;
        pointAIndex = pending.pointAIndex;
        pointBIndex = pending.pointBIndex;

        // Use modular arithmetic to correctly handle wrapping in closed polygons.
        // A point is "after" the center if its cyclic distance is +1 (mod n).
        const n = polygonData.points.length;
        pointAIsAfterCenter = mod(pointAIndex - centerIndex, n) === 1;
        pointBIsAfterCenter = mod(pointBIndex - centerIndex, n) === 1;

        // Get any constraints attached to the centerIndex, and move these to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const constraint = ConstraintComponent.get(c);
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = Constraint.getEndpoint(c, key);
            if (
              ep &&
              ep.type === 'locked-polygon' &&
              ep.id === geometryId &&
              ep.pointIndex === pending.centerIndex
            ) {
              // Found a constraint attached to the "center" point!
              // So make a datum if needed and migrate it over to be locked to the datum.
              if (!centerDatumId) {
                const datum = geometryStore.addOrdered(
                  ID_PREFIXES.datum,
                  Datum.create(polygonData.points[pending.centerIndex].point),
                );
                centerDatumId = datum.id;
              }
              geometryStore.updateByIdWithComponent(c.id, ConstraintComponent, (g) =>
                ConstraintComponent.update(g, {
                  [key]: ConstraintEndpoint.lockedToDatum(centerDatumId!),
                }),
              );
            }
          }
        }
        break;
      }
      case 'rectangle': {
        const resolvedCenter = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.centerEndpoint),
        );
        const resolvedA = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.pointAEndpoint),
        );
        const resolvedB = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.pointBEndpoint),
        );
        if (!resolvedCenter || !resolvedA || !resolvedB) {
          throw new Error(
            'BaseCornerGeometryReplacerTool.resolveGeometryAndIndices: rectangle endpoints not resolved',
          );
        }

        // Get any constraints attached to the "center" point, and move these to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = Constraint.getEndpoint(c, key);
            if (
              ep &&
              ep.type === 'locked-rectangle' &&
              ep.id === geometryId &&
              ep.point === pending.centerEndpoint
            ) {
              // Found a constraint attached to the "center" point!
              // So make a datum if needed and migrate it over to be locked to the datum.
              if (!centerDatumId) {
                const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(resolvedCenter));
                centerDatumId = datum.id;
              }
              geometryStore.updateByIdWithComponent(c.id, ConstraintComponent, (g) =>
                ConstraintComponent.update(g, {
                  [key]: ConstraintEndpoint.lockedToDatum(centerDatumId!),
                }),
              );
            }
          }
        }

        // Convert from rectangle => polygon
        geometry = geometryStore.convertRectangleToPolygon(geometryId, {
          insertConstraints: false,
        });
        geometryId = geometry.id;
        polygonData = GeometryComponent.get(geometry);

        // Find all three point indices by position in the new polygon
        for (
          let i = 0;
          i < polygonData.points.length - 1 /* subtract final closed point */;
          i += 1
        ) {
          const p = polygonData.points[i].point;
          if (p.x === resolvedCenter.x && p.y === resolvedCenter.y) {
            centerIndex = i;
          }
          if (p.x === resolvedA.x && p.y === resolvedA.y) {
            pointAIndex = i;
          }
          if (p.x === resolvedB.x && p.y === resolvedB.y) {
            pointBIndex = i;
          }
        }

        if (
          typeof centerIndex !== 'number' ||
          typeof pointAIndex !== 'number' ||
          typeof pointBIndex !== 'number'
        ) {
          throw new Error(
            'BaseCornerGeometryReplacerTool.resolveGeometryAndIndices: could not find all point indices',
          );
        }

        if (polygonData.closed) {
          // pointAIndex or pointBIndex being at 0 or points.length-1 means sort of the same thing for
          // closed polygons (which a converted rectangle always will be).
          //
          // It is sort of domain specific which one you want... so if one point is at an extreme,
          // then compute the other point and use the negation of it as the original point value
          // (since they should always be on opposite sides of each other).
          const pointsLengthWithoutClosed = polygonData.points.length - 1;
          if (pointAIndex === 0 || pointAIndex === pointsLengthWithoutClosed - 1) {
            pointBIsAfterCenter = pointBIndex > centerIndex;
            pointAIsAfterCenter = !pointBIsAfterCenter;
          } else if (pointBIndex === 0 || pointBIndex === pointsLengthWithoutClosed - 1) {
            pointAIsAfterCenter = pointAIndex > centerIndex;
            pointBIsAfterCenter = !pointAIsAfterCenter;
          } else {
            pointAIsAfterCenter = pointAIndex > centerIndex;
            pointBIsAfterCenter = pointBIndex > centerIndex;
          }
        } else {
          // Open polygons need no special logic.
          pointAIsAfterCenter = pointAIndex > centerIndex;
          pointBIsAfterCenter = pointBIndex > centerIndex;
        }

        while (centerIndex >= polygonData.points.length - 1) {
          centerIndex -= polygonData.points.length - 1;
        }
        while (pointAIndex >= polygonData.points.length - 1) {
          pointAIndex -= polygonData.points.length - 1;
        }
        while (pointBIndex >= polygonData.points.length - 1) {
          pointBIndex -= polygonData.points.length - 1;
        }

        break;
      }
      default:
        pending satisfies never;
        throw new Error(
          `BaseCornerGeometryReplacerTool.resolveGeometryAndIndices: Unknown pending.mode value ${(pending as any).mode}`,
        );
    }

    return {
      geometryId,
      polygon: geometry,
      polygonData,
      centerIndex,
      pointAIndex,
      pointBIndex,
      centerDatumId,
      pointAIsAfterCenter,
      pointBIsAfterCenter,
    };
  }

  /**
   * Validates that the offset is smaller than both edge lengths from center to pointA
   * and center to pointB. Returns positions and pre-computed t values used by subsequent
   * steps to locate split points and determine arc geometry. Returns null if the offset
   * is too large (silent early exit).
   */
  private validateOffset(
    step1: ResolveGeometryAndIndicesResults,
    offset: number,
  ): ValidateOffsetResults | null {
    const polygonData = step1.polygonData;
    const centerIndex = step1.centerIndex;
    const pointAIndex = step1.pointAIndex;
    const pointBIndex = step1.pointBIndex;

    const centerPos = polygonData.points[centerIndex].point;
    const pointAPos = polygonData.points[pointAIndex].point;
    const pointBPos = polygonData.points[pointBIndex].point;

    const lenA = Vector2.dist(centerPos, pointAPos);
    const lenB = Vector2.dist(centerPos, pointBPos);

    if (offset >= lenA || offset >= lenB) {
      return null;
    }
    // Compute split t values using the CENTER position from the polygon

    // For the edge from center->point: segment starts at centerIndex, t = offset/len
    // For the edge from point->center: segment starts at pointIndex, t = 1 - offset/len
    const tA = step1.pointAIsAfterCenter ? offset / lenA : 1 - offset / lenA;
    const tB = step1.pointBIsAfterCenter ? offset / lenB : 1 - offset / lenB;

    return {
      centerPos,
      pointAPos,
      pointBPos,
      lenA,
      lenB,
      tA,
      tB,
      offset,
    };
  }

  /**
   * Inserts two new vertices on the polygon edges at the offset distance from the
   * center. Uses PolygonComponent.addPointOnEdge to insert midpoint vertices at the
   * calculated t values. Split indices are computed higher-first to avoid index-shift
   * issues during insertion. Constraint history events are replayed to maintain constraint
   * integrity.
   */
  private splitEdgesAtOffset(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
  ): SplitEdgesAtOffsetResults {
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    let geometry = step1.polygon;
    const geometryId = step1.geometryId;
    const polygonData = step1.polygonData;

    // Split both edges (higher index first to avoid index shifts)
    let sortedSplits = [
      { index: step1.pointAIsAfterCenter ? step1.pointAIndex - 1 : step1.pointAIndex, t: step2.tA },
      { index: step1.pointBIsAfterCenter ? step1.pointBIndex - 1 : step1.pointBIndex, t: step2.tB },
    ]
      .map((sp) => {
        while (sp.index < 0) {
          sp.index += polygonData.points.length - 1;
        }
        return sp;
      })
      .sort((a, b) => b.index - a.index);

    for (const { index, t } of sortedSplits) {
      const currentConstraints = geometryStore.findConstraintsByGeometryId(geometryId);
      const result = GeometryComponent.addPointOnEdge(geometry, currentConstraints, index, {
        type: 't',
        t,
      });
      if (!result) {
        continue;
      }
      geometry = result.geometry as typeof geometry;

      for (const event of result.updatedConstraintHistoryEvents) {
        historyManager.apply(event);
      }
    }

    geometryStore.updateById(geometryId, geometry);

    // Find split positions and rebuild the polygon with the corner segment.
    // Position matching replaces fragile index arithmetic — the array-seam
    // wrapping case (center at index 0 of a closed polygon) is inherently
    // handled by comparing positions rather than computing shifted indices.
    const splitAPos = Vector2.lerp(step2.centerPos, step2.pointAPos, step2.offset / step2.lenA);
    const splitBPos = Vector2.lerp(step2.centerPos, step2.pointBPos, step2.offset / step2.lenB);

    const currentPoints = GeometryComponent.get(geometry).points;
    const splitAIdx = this.findPointIndexByPos(currentPoints, splitAPos);
    const splitBIdx = this.findPointIndexByPos(currentPoints, splitBPos);
    const centerIdxFirst = this.findPointIndexByPos(currentPoints, step2.centerPos);

    if (splitAIdx < 0 || splitBIdx < 0 || centerIdxFirst < 0) {
      throw new Error(
        'BaseCornerGeometryReplacerTool.splitEdgesAtOffset: could not find split or center indices',
      );
    }

    return {
      geometry,
      splitAPos,
      splitBPos,
      splitAIdx,
      splitBIdx,
      centerIdxFirst,
    };
  }

  /**
   * Creates the polygon segment that replaces the corner vertex between two split points.
   * The returned segment's `point` field should be set to the given `point` parameter
   * (the destination position for this segment in the polygon).
   *
   * For FilletTool: returns a CubicBezierSegment with control points computed from
   *   the tangents, offset, and corner angle.
   * For ChamferTool: returns a simple PointSegment.
   *
   * @param point - Destination position for the segment in the polygon.
   * @param p0 - Start position of the corner replacement curve.
   * @param p3 - End position of the corner replacement curve.
   * @param tStart - Unit tangent direction at the start point.
   * @param tEnd - Unit tangent direction at the end point.
   * @param offset - The fillet/chamfer offset distance.
   * @param step2 - Results from validateOffset.
   */
  protected abstract createCornerSegment(
    point: SheetPosition,
    p0: SheetPosition,
    p3: SheetPosition,
    tStart: SheetPosition,
    tEnd: SheetPosition,
    offset: number,
    step2: ValidateOffsetResults,
  ): PolygonSegment;

  /**
   * Determines whether the arc wraps around the polygon seam or replaces the
   * center in-place, computes tangent directions, and rebuilds the polygon with
   * the corner replacement segment inserted at the correct position. Uses
   * createCornerSegment to produce the actual segment geometry.
   */
  private buildCornerSegment(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    step3: SplitEdgesAtOffsetResults,
  ): BuildCornerSegmentResults {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const centerPos = step2.centerPos;
    const pointAPos = step2.pointAPos;
    const pointBPos = step2.pointBPos;
    const splitAPos = step3.splitAPos;
    const splitBPos = step3.splitBPos;
    const splitAIdx = step3.splitAIdx;
    const splitBIdx = step3.splitBIdx;
    const centerIdxFirst = step3.centerIdxFirst;
    const offset = step2.offset;

    const minSplitIdx = Math.min(splitAIdx, splitBIdx);
    const maxSplitIdx = Math.max(splitAIdx, splitBIdx);
    const isWrapping = !(minSplitIdx < centerIdxFirst && centerIdxFirst < maxSplitIdx);

    // Compute tangents from polygon edge directions at the split points.
    // The tangent at P0 matches the direction from the previous vertex toward P0;
    // the tangent at P3 matches the direction from P3 toward the next vertex.
    const pts = GeometryComponent.get(step3.geometry).points;
    let p0: SheetPosition;
    let p3: SheetPosition;
    let tStart: SheetPosition;
    let tEnd: SheetPosition;

    if (isWrapping) {
      if (maxSplitIdx === splitAIdx) {
        p0 = splitAPos;
        p3 = splitBPos;
      } else {
        p0 = splitBPos;
        p3 = splitAPos;
      }
      tStart = Vector2.norm(
        Vector2.sub(p0, pts[(maxSplitIdx - 1 + pts.length) % pts.length].point),
      );
    } else if (maxSplitIdx === splitAIdx) {
      p0 = splitBPos;
      p3 = splitAPos;
      tStart = Vector2.norm(Vector2.sub(p0, pts[splitBIdx - 1].point));
    } else {
      p0 = splitAPos;
      p3 = splitBPos;
      tStart = Vector2.norm(Vector2.sub(p0, pts[splitAIdx - 1].point));
    }

    if (isWrapping) {
      tEnd = Vector2.norm(Vector2.sub(pts[(minSplitIdx + 1) % pts.length].point, p3));
    } else if (maxSplitIdx === splitAIdx) {
      tEnd = Vector2.norm(Vector2.sub(pts[splitAIdx + 1].point, p3));
    } else {
      tEnd = Vector2.norm(Vector2.sub(pts[splitBIdx + 1].point, p3));
    }

    let addedSegmentIndex = -1;
    geometryStore.updateById(geometryId, (old) => {
      if (!Entity.hasComponent(old, GeometryComponent)) {
        return old;
      }
      const oldPoints = GeometryComponent.get(old as Entity<GeometryComponent<PolygonData>>).points;
      let newPoints: Array<PolygonSegment>;
      if (isWrapping) {
        const segment = this.createCornerSegment(
          oldPoints[minSplitIdx].point,
          p0,
          p3,
          tStart,
          tEnd,
          offset,
          step2,
        );
        newPoints = [...oldPoints.slice(minSplitIdx, maxSplitIdx + 1), segment];
        addedSegmentIndex = newPoints.length - 1;
      } else if (maxSplitIdx === splitAIdx) {
        const segment = this.createCornerSegment(
          oldPoints[splitAIdx].point,
          p0,
          p3,
          tStart,
          tEnd,
          offset,
          step2,
        );
        newPoints = [
          ...oldPoints.slice(0, splitAIdx - 1),
          segment,
          ...oldPoints.slice(splitBIdx + 3),
        ];
        addedSegmentIndex = splitAIdx - 2;
      } else {
        const segment = this.createCornerSegment(
          oldPoints[splitBIdx].point,
          p0,
          p3,
          tStart,
          tEnd,
          offset,
          step2,
        );
        newPoints = [
          ...oldPoints.slice(0, splitBIdx - 1),
          segment,
          ...oldPoints.slice(splitAIdx + 3),
        ];
        addedSegmentIndex = splitBIdx - 2;
      }
      return GeometryComponent.update(old as Entity<GeometryComponent<PolygonData>>, {
        points: newPoints,
      });
    });

    return {
      geometry: geometryStore.getByIdWithComponent(geometryId, GeometryComponent) as Entity<
        GeometryComponent<PolygonData>
      >,
      addedSegmentIndex,
    };
  }

  /**
   * Adds colinear constraints linking the center datum to the far vertices (pointA, pointB)
   * and their corresponding split vertices. These constraints keep the corner replacement
   * centered on the original corner. Must happen AFTER segment insertion so indices resolve
   * against the final polygon.
   */
  private addColinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    step3: SplitEdgesAtOffsetResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const centerDatumId = step1.centerDatumId;

    if (!centerDatumId) {
      return;
    }

    const finalPoly = geometryStore.getByIdWithComponent(geometryId, GeometryComponent) as Entity<
      GeometryComponent<PolygonData>
    >;
    if (!finalPoly) {
      return;
    }
    const finalPoints = GeometryComponent.get(
      finalPoly as Entity<GeometryComponent<PolygonData>>,
    ).points;

    const farAIdx = this.findPointIndexByPos(finalPoints, step2.pointAPos);
    const splitAFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitAPos);
    const farBIdx = this.findPointIndexByPos(finalPoints, step2.pointBPos);
    const splitBFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitBPos);

    if (farAIdx >= 0 && splitAFinalIdx >= 0) {
      geometryStore.add(
        ID_PREFIXES.constraint,
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farAIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitAFinalIdx),
        ),
      );
    }
    if (farBIdx >= 0 && splitBFinalIdx >= 0) {
      geometryStore.add(
        ID_PREFIXES.constraint,
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farBIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitBFinalIdx),
        ),
      );
    }
  }

  /**
   * For polygons created by converting a rectangle, adds horizontal constraints on
   * top/bottom edges and vertical constraints on left/right edges. Iterates perimeter
   * points in order, skipping over the inserted segment index. The rectangle is always
   * converted to a 5-point polygon (4 sides + 1 corner segment), so this iterates the
   * 4 sides in ['top', 'right', 'bottom', 'left'] order.
   */
  private addRectilinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step4: BuildCornerSegmentResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const addedSegmentIndex = step4.addedSegmentIndex;

    // Only applies when a rectangle was converted to a polygon.
    // This happens when resolveGeometryAndIndices processed a 'rectangle' mode pending state,
    // which we detect by checking if the polygon has 5 points and was closed.
    const polygonData = step1.polygonData;
    if (polygonData.points.length !== 5 || !polygonData.closed) {
      return;
    }

    let counter = 0;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const pointA = ConstraintEndpoint.lockedToPolygon(geometryId, counter);
      let pointBIndex = counter + 1;
      if (pointBIndex > 4 /* 4 sides */) {
        pointBIndex = 0;
      }
      const pointB = ConstraintEndpoint.lockedToPolygon(geometryId, pointBIndex);

      switch (side) {
        case 'top':
        case 'bottom':
          geometryStore.add(ID_PREFIXES.constraint, HorizontalConstraint.create(pointA, pointB));
          break;
        case 'left':
        case 'right':
          geometryStore.add(ID_PREFIXES.constraint, VerticalConstraint.create(pointA, pointB));
          break;
      }

      counter += 1;
      if (counter === addedSegmentIndex) {
        // Skip over the corner segment
        counter += 1;
      }
    }
  }

  /** Finds the index of a point in polygon points by position match. */
  private findPointIndexByPos(points: Array<{ point: SheetPosition }>, pos: SheetPosition): number {
    for (let i = 0; i < points.length; i++) {
      if (points[i].point.x === pos.x && points[i].point.y === pos.y) {
        return i;
      }
    }
    return -1;
  }
}

/** Modular arithmetic helper that returns a non-negative remainder. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
