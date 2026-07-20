import {
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  Entity,
  GeometryComponent,
  type Id,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { type RectangleEndpoint } from '@/lib/entity/rectangle';
import { applyKeyPointSnapping } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { FilterTemplate } from '../entity/filters';
import { BaseTool } from './BaseTool';
import { FilterComponent } from '../entity/components/FilterComponent';

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

  protected abstract createFilter(pending: CornerState, offset: Length): FilterTemplate;

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
      this.commit();
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

        // Make sure there isn't an existing filter on this corner point
        // If so, then don't allow another filter to be placed on it.
        const existingFilter = this.getGeometryStore().findFiltersByGeometryId(keyPointEndpoint.id).find(
          (f) => FilterComponent.isLockedToRectangle(f, keyPointEndpoint.id, keyPointEndpoint.point)
        );
        if (existingFilter) {
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

        // Make sure there isn't an existing filter on this corner point
        // If so, then don't allow another filter to be placed on it.
        const existingFilter = this.getGeometryStore().findFiltersByGeometryId(keyPointEndpoint.id).find(
          (f) => FilterComponent.isLockedToPolygon(f, keyPointEndpoint.id, keyPointEndpoint.pointIndex)
        );
        if (existingFilter) {
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
        const polygon = GeometryComponent.get(geometry);
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
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    this.getGeometryStore().add(
      ID_PREFIXES.filter,
      this.createFilter(pending, this.state.currentOffset),
    );

    this.lastCommittedOffset = this.state.currentOffset;
    this.abort();
  }

  private abort(): void {
    this.state = { type: 'idle' };
    this.emit('pendingCornerChange', null);
    this.emit('activeCornerChange', null);
    this.emit('keyPointSnapChange', null);
  }
}
