import { MousePointer2Icon } from 'lucide-react';
import { applyToPoint, inverse } from 'transformation-matrix';
import { type DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import {
  Constraint,
  ConstraintComponent,
  type CubicBezierSegment,
  Datum,
  DatumComponent,
  Entity,
  EntityOmitComponents,
  FillColorComponent,
  GeometryComponent,
  type Id,
  LinkDimensionsComponent,
  PolygonSegment,
  type QuadraticBezierSegment,
  RenderOrderComponent,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeMode,
  type ResizeParams,
  TransformableComponent,
} from '@/lib/entity';
import { ID_PREFIXES, getPrefixFromId } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { FrameComponent } from '@/lib/entity/components/FrameComponent';
import { RotationComponent, RotationData } from '@/lib/entity/components/RotationComponent';
import { TransformableTemplate } from '@/lib/entity/components/templates/TransformableTemplate';
import {
  type CoincidentConstraintData,
  ConstrainedTrack,
  ConstrainedTrackPath,
  ConstraintData,
  ConstraintEndpoint,
} from '@/lib/entity/constraints';
import { Filter, FilterData } from '@/lib/entity/filters';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { UndoEntry } from '@/lib/history/types';
import {
  BoundingBox,
  OrientedBoundingBox,
  Vector2,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
  rotateAnchorAroundPivot,
  rotatePointAround,
} from '@/lib/math';
import {
  type SelectionResizeFrame,
  computeResizePointerOutset,
  computeSelectionResizeFrame,
} from '@/lib/selection/resize-frame';
import {
  ANGLE_SNAP_DEGREES,
  applyKeyPointSnapping,
  applyRotationOnConstrainedTrack,
  applySnapping,
  applySnappingLineSeries,
  applySnappingOnConstrainedTrack,
  computeConstrainedRotationDelta,
} from '@/lib/snapping';
import { Angle } from '@/lib/units/angle';
import { type UnitType } from '@/lib/units/length';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { ViewportControls } from '../viewport/ViewportControls';
import {
  GeometryRelativeSheetPosition,
  type OrientedRect,
  Rect,
  ScreenPosition,
  SheetPosition,
  type ViewportState,
} from '../viewport/types';
import { BaseTool } from './BaseTool';
import { type DraggingShapeState } from './types';

export type SelectToolClosestPointToSegmentChange = {
  polygonId: Id;
  segmentIndex: number;
  point: SheetPosition;
};

/** Events emitted by SelectTool. */
export type SelectToolEvents = {
  dragStateChange: (draggingShapeState: DraggingShapeState | null) => void;
  closestPointToSegmentChange: (closestPoint: SelectToolClosestPointToSegmentChange | null) => void;
  hoveringPolygonSegmentChange: (hovering: boolean) => void;
  hoveringConstraintLabelChange: (constraintId: Constraint['id'] | null) => void;
  hoveringFilterLabelChange: (filterId: Filter['id'] | null) => void;
  dragSelectBoundingBoxChange: (bounds: Rect<SheetPosition> | null) => void;
  entityPickBegin: () => void;
  entityPickEnd: (entityId: Entity['id'] | null) => void;
};

/** The pixels offset the selected bounded box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;

export type VisibleTooltip = 'add-point' | 'geometry-fill' | 'rotate-geometry' | null;

/** Timeout before a tooltip shows up next to a user's mouse giving them hints on what they can do
 * with the geometry - alt drag to duplicate, etc */
const GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS = 500;

const ADD_POINT_TOOLTIP_TIMEOUT_MS = 100;

/**
 * Computes the origin point for snapping a dragged selection. The origin is the upper-left
 * corner of the union bounding box of all shapes in the selection. For a single shape this
 * corresponds to the selection-inspector x/y (upperLeft for rectangle, center for ellipse,
 * bounding box upper-left for polygon).
 */
function computeSelectionOrigin(states: Map<Id, DragState | null>): SheetPosition | null {
  let minX = Infinity;
  let minY = Infinity;
  for (const state of states.values()) {
    if (!state) {
      continue;
    }
    if (states.size === 1) {
      return DragState.getOrigin(state);
    }
    const bbox = DragState.boundingBox(state);
    if (!bbox) {
      continue;
    }
    if (bbox.position.x < minX) {
      minX = bbox.position.x;
    }
    if (bbox.position.y < minY) {
      minY = bbox.position.y;
    }
  }
  return new SheetPosition(minX, minY);
}

/** Returns the rendered position that must remain pinned in rendered space during a
 * rotation-aware resize: the opposite handle, or the center when alt-dragging. */
function getPinnedResizePosition(
  mode: ResizeMode,
  frame: OrientedRect<SheetPosition>,
  centerPinned: boolean,
): SheetPosition {
  const corners = OrientedBoundingBox.corners(frame);
  const mid = (a: SheetPosition, b: SheetPosition) =>
    new SheetPosition((a.x + b.x) / 2, (a.y + b.y) / 2);

  if (centerPinned) {
    return mid(corners.upperLeft, corners.lowerRight);
  }

  if (mode.type === 'corner') {
    switch (mode.corner) {
      case 'top-left':
        return corners.lowerRight;
      case 'top-right':
        return corners.lowerLeft;
      case 'bottom-left':
        return corners.upperRight;
      case 'bottom-right':
        return corners.upperLeft;
    }
  }

  switch (mode.edge) {
    case 'top':
      return mid(corners.lowerLeft, corners.lowerRight);
    case 'bottom':
      return mid(corners.upperLeft, corners.upperRight);
    case 'left':
      return mid(corners.upperRight, corners.lowerRight);
    case 'right':
      return mid(corners.upperLeft, corners.lowerLeft);
  }
}

/** Returns the rendered sheet position of an oriented bounding box corner. */
function getOrientedCornerPosition(
  corner: ResizeCorner,
  frame: OrientedRect<SheetPosition>,
): SheetPosition {
  const corners = OrientedBoundingBox.corners(frame);
  switch (corner) {
    case 'top-left':
      return corners.upperLeft;
    case 'top-right':
      return corners.upperRight;
    case 'bottom-left':
      return corners.lowerLeft;
    case 'bottom-right':
      return corners.lowerRight;
  }
}

/** Checks whether a constraint's shape endpoint lies on the edge being dragged. */
function isEndpointOnEdge(
  endpoint: ConstraintEndpoint,
  edge: ResizeEdge,
  endpointPos: SheetPosition,
  unionBBox: Rect<SheetPosition>,
): boolean {
  switch (endpoint.type) {
    case 'locked-rectangle': {
      switch (edge) {
        case 'top':
          return endpoint.point === 'upperLeft' || endpoint.point === 'upperRight';
        case 'bottom':
          return endpoint.point === 'lowerLeft' || endpoint.point === 'lowerRight';
        case 'left':
          return endpoint.point === 'upperLeft' || endpoint.point === 'lowerLeft';
        case 'right':
          return endpoint.point === 'upperRight' || endpoint.point === 'lowerRight';
      }
    }
    case 'locked-ellipse': {
      switch (edge) {
        case 'top':
          return endpoint.point === 'top';
        case 'bottom':
          return endpoint.point === 'bottom';
        case 'left':
          return endpoint.point === 'left';
        case 'right':
          return endpoint.point === 'right';
      }
    }
    case 'locked-polygon': {
      const EPS = 1e-10;
      switch (edge) {
        case 'top':
          return Math.abs(endpointPos.y - unionBBox.position.y) < EPS;
        case 'bottom':
          return Math.abs(endpointPos.y - (unionBBox.position.y + unionBBox.height)) < EPS;
        case 'left':
          return Math.abs(endpointPos.x - unionBBox.position.x) < EPS;
        case 'right':
          return Math.abs(endpointPos.x - (unionBBox.position.x + unionBBox.width)) < EPS;
      }
    }
    default:
      return false;
  }
}

/** Transforms a constrained track by a point transform and a corresponding angle delta. */
function transformConstrainedTrack(
  track: ConstrainedTrack,
  transformPoint: (position: SheetPosition) => SheetPosition,
  angleDeltaDegrees: number,
): ConstrainedTrack {
  switch (track.type) {
    case 'circle':
      return { type: 'circle', center: transformPoint(track.center), radius: track.radius };
    case 'point':
      return { type: 'point', point: transformPoint(track.point) };
    case 'line': {
      const angleRadians = (angleDeltaDegrees * Math.PI) / 180;
      const baseAngle = Number.isFinite(track.slope) ? Math.atan(track.slope) : Math.PI / 2;
      const nextAngle = baseAngle + angleRadians;
      const cos = Math.cos(nextAngle);
      return {
        type: 'line',
        point: transformPoint(track.point),
        slope: Math.abs(cos) < 1e-10 ? Infinity : Math.tan(nextAngle),
      };
    }
    case 'or':
      return {
        type: 'or',
        inner: track.inner.map((inner) =>
          transformConstrainedTrack(inner, transformPoint, angleDeltaDegrees),
        ),
      };
  }
}

/** Converts a rendered sheet position into a geometry's raw absolute sheet position. */
function renderedPointToRaw(
  geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  rendered: SheetPosition,
): SheetPosition {
  const raw = applyToPoint(inverse(Entity.generateRenderMatrix(geometry)), rendered);
  return new SheetPosition(raw.x, raw.y);
}

function normalizeAngleDegrees(angleDegrees: number): number {
  const normalized = angleDegrees % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function pointsClose(a: SheetPosition, b: SheetPosition): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
}

/** Returns the raw absolute position of the geometry's anchor key point, if it has an anchor. */
function anchorKeyPointRawPosition(
  geometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
): SheetPosition | null {
  if (!Entity.hasComponent(geometry, AnchorPointComponent)) {
    return null;
  }
  const anchor = AnchorPointComponent.get(geometry);
  const local = AnchorPointComponent.resolveKeyPointPosition(geometry, anchor.keyPoint);
  if (!local) {
    return null;
  }
  const origin = GeometryComponent.getOrigin(geometry);
  return new SheetPosition(origin.x + local.x, origin.y + local.y);
}

/**
 * If `originalRawPoint` is the geometry's anchor key point, adjusts the anchor offset so the
 * derived anchor translation stays put while the moved point renders where it was dragged.
 */
function compensateAnchorForMovedKeyPoint<
  G extends Entity<GeometryComponent & Partial<AnchorPointComponent>>,
>(
  originalGeometry: Entity<GeometryComponent & Partial<AnchorPointComponent>>,
  updated: G,
  originalRawPoint: SheetPosition,
): G {
  if (
    !Entity.hasComponent(originalGeometry, AnchorPointComponent) ||
    !Entity.hasComponent(updated, AnchorPointComponent)
  ) {
    return updated;
  }
  const originalKeyPoint = anchorKeyPointRawPosition(originalGeometry);
  if (!originalKeyPoint || !pointsClose(originalKeyPoint, originalRawPoint)) {
    return updated;
  }

  const anchor = AnchorPointComponent.get(updated);
  const updatedKeyPoint = anchorKeyPointRawPosition(updated);
  if (!updatedKeyPoint) {
    return updated;
  }

  const derivedOffset = new SheetPosition(
    originalKeyPoint.x + AnchorPointComponent.get(originalGeometry).offset.x,
    originalKeyPoint.y + AnchorPointComponent.get(originalGeometry).offset.y,
  );
  return AnchorPointComponent.update(updated, {
    keyPoint: anchor.keyPoint,
    offset: new SheetPosition(
      derivedOffset.x - updatedKeyPoint.x,
      derivedOffset.y - updatedKeyPoint.y,
    ),
  }) as G;
}

/** A representation of all entities which can be moved. The type is a union, and the associated
 * namespace has utility functions for computing metrics about the given entity in a generic way. */
type DragState =
  | {
      state: 'geometry';
      geometry: Entity<
        GeometryComponent & Partial<AnchorPointComponent> & Partial<RotationComponent>
      >;
    }
  | { state: 'datum'; entity: Entity<DatumComponent> }
  | { state: 'filter'; entity: Entity<FilterComponent> }
  | { state: 'frame'; entity: Entity<FrameComponent> }
  | { state: 'transformable'; entity: Entity };

namespace DragState {
  /** Extracts the {@link DragState} from the passed {@link Entity}, or null if nothing could be computed. */
  export function get(entity: Entity): DragState | null {
    if (Entity.hasComponent(entity, GeometryComponent)) {
      const geometry = Entity.pickComponent(entity, GeometryComponent);
      // Preserve transform components so origin / bbox / resize metrics see the full render
      // transform.
      return {
        state: 'geometry',
        geometry: {
          id: geometry.id,
          components: {
            ...geometry.components,
            ...(Entity.hasComponent(entity, AnchorPointComponent)
              ? { anchorPoint: entity.components.anchorPoint }
              : {}),
            ...(Entity.hasComponent(entity, RotationComponent)
              ? { rotation: entity.components.rotation }
              : {}),
          },
        },
      };
    } else if (TransformableTemplate.getForEntity(entity)) {
      return { state: 'transformable', entity };
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return { state: 'datum', entity };
    } else if (Entity.hasComponent(entity, FrameComponent)) {
      // NOTE: make sure this is before filter, so that a PatternGrid registers as
      // a "frame", not a "filter".
      return { state: 'frame', entity };
    } else if (Entity.hasComponent(entity, FilterComponent)) {
      return { state: 'filter', entity };
    }
    return null;
  }

  /** Takes a given {@link DragState} and updated the passed {@link Entity} to contin its data. */
  export function apply(state: DragState, entity: Entity): Entity {
    switch (state.state) {
      case 'geometry': {
        let updated = Entity.assignComponent(entity, GeometryComponent, state.geometry);
        if (Entity.hasComponent(state.geometry, AnchorPointComponent)) {
          updated = Entity.assignComponent(updated, AnchorPointComponent, state.geometry);
        }
        if (Entity.hasComponent(state.geometry, RotationComponent)) {
          updated = Entity.assignComponent(updated, RotationComponent, state.geometry);
        }
        return updated;
      }
      case 'datum':
        return Entity.assignComponent(entity, DatumComponent, state.entity);
      case 'filter':
        return Entity.assignComponent(entity, FilterComponent, state.entity);
      case 'frame':
        return Entity.assignComponent(entity, FrameComponent, state.entity);
      case 'transformable': {
        const adapter = TransformableTemplate.getForEntity(state.entity);
        let updated = adapter ? adapter.update(entity, adapter.get(state.entity)) : entity;
        if (Entity.hasComponent(state.entity, RotationComponent)) {
          updated = Entity.assignComponent(updated, RotationComponent, state.entity);
        }
        return updated;
      }
      default:
        state satisfies never;
        throw new Error(`DragState.update: No drag state case for ${(state as any).state}`);
    }
  }

  /** Apply the given {@link transform} function to the passed DragState, usually for translation. */
  export function translate(
    state: DragState,
    transform: (input: SheetPosition) => SheetPosition,
  ): DragState {
    switch (state.state) {
      case 'geometry':
        return { ...state, geometry: GeometryComponent.transform(state.geometry, transform) };
      case 'datum':
        return { ...state, entity: DatumComponent.translate(state.entity, transform) };
      case 'filter':
        return { ...state, entity: FilterComponent.translate(state.entity, transform) };
      case 'frame':
        return { ...state, entity: FrameComponent.translate(state.entity, transform) };
      case 'transformable': {
        const adapter = TransformableTemplate.getForEntity(state.entity);
        if (!adapter?.translate) {
          return state;
        }
        return { ...state, entity: adapter.translate(state.entity, transform) };
      }
      default:
        state satisfies never;
        throw new Error(`DragState.translate: No drag state case for ${(state as any).state}`);
    }
  }

  /** Are the two {@link DragState}s equal? */
  export function equals(a: DragState, b: DragState | null) {
    if (!b) {
      return false;
    }
    switch (a.state) {
      case 'geometry':
        if (b.state !== 'geometry') {
          return false;
        }
        return GeometryComponent.equals(a.geometry, b.geometry);
      case 'datum':
        if (b.state !== 'datum') {
          return false;
        }
        return DatumComponent.equals(a.entity, b.entity);
      case 'filter':
        if (b.state !== 'filter') {
          return false;
        }
        return FilterComponent.equals(a.entity, b.entity);
      case 'frame':
        if (b.state !== 'frame') {
          return false;
        }
        return FrameComponent.equals(a.entity, b.entity);
      case 'transformable': {
        if (b.state !== 'transformable') {
          return false;
        }
        const adapter = TransformableTemplate.getForEntity(a.entity);
        return adapter ? adapter.equals(a.entity, b.entity) : false;
      }
      default:
        a satisfies never;
        throw new Error(`DragState.equals: No drag state case for ${(a as any).state}`);
    }
  }

  /** Returns the origin point of a {@link DragState}, corresponding to what the selection inspector
   *  shows as the shape's x/y position. For rectangle this is upperLeft, for ellipse it is center,
   *  for polygon it is the bounding box upper-left corner. */
  export function getOrigin(state: DragState): SheetPosition | null {
    switch (state.state) {
      case 'geometry':
        return GeometryComponent.getRenderOrigin(state.geometry);
      case 'datum':
        return DatumComponent.getOrigin(state.entity);
      case 'filter':
        return null;
      case 'frame':
        return FrameComponent.getOrigin(state.entity);
      case 'transformable': {
        const adapter = TransformableTemplate.getForEntity(state.entity);
        return adapter ? adapter.getOrigin(state.entity) : null;
      }
      default:
        state satisfies never;
        throw new Error(`DragState.getOrigin: No drag state case for ${(state as any).state}`);
    }
  }

  /** Compute an axis aligned bounding box around the given {@link DragState}. */
  export function boundingBox(state: DragState): Rect<SheetPosition> | null {
    switch (state.state) {
      case 'geometry':
        return Entity.boundingBoxInSheet(state.geometry);
      case 'datum':
        return {
          position: DatumComponent.getOrigin(state.entity),
          width: 0,
          height: 0,
        };
      case 'filter':
        return null;
      case 'frame':
        return FrameComponent.boundingBox(state.entity);
      case 'transformable':
        return Entity.boundingBoxInSheet(state.entity);
      default:
        state satisfies never;
        throw new Error(`DragState.boundingBox: No drag state case for ${(state as any).state}`);
    }
  }

  /** Takes the passed {@link DragState} and resizes the geometry using {@link ResizeParams}. */
  export function resize(
    state: DragState,
    params: ResizeParams,
    originalBBox?: OrientedRect<SheetPosition>,
  ): DragState | null {
    switch (state.state) {
      case 'geometry': {
        const resized = GeometryComponent.resize(state.geometry, params, originalBBox);
        if (!resized) {
          return null;
        }
        return { ...state, geometry: resized };
      }
      case 'datum':
      case 'filter':
      case 'transformable':
        return null;
      case 'frame': {
        const resized = FrameComponent.resize(state.entity, params, originalBBox);
        if (!resized) {
          return null;
        }
        return { ...state, entity: resized };
      }
      default:
        state satisfies never;
        console.warn(`DragState.resize: Unknown state.for ${(state as any)?.for}. Doing nothing.`);
        return state;
    }
  }
}

/** A tool for selecting / manipulating polygons. */
export class SelectTool extends BaseTool<SelectToolEvents> {
  type = 'select' as const;
  focusKeyCombo = 's' as const;

  label = 'Select';
  get icon(): React.ReactNode {
    return <MousePointer2Icon size={24} color="white" />;
  }

  private activeDragListener: DragListener | null = null;
  private draggingPolygonId: Id | null = null;
  private draggingSegmentIndex: number = -1;
  private draggingPointKey: string = '';
  private dragStartSheetPos: SheetPosition | null = null;
  private initialDragStateChangeEmitted: boolean = false;

  private originalDragState = new Map<Id, DragState | null>();
  /** Stores the original polygon state for restore on cancel. */
  private originalPolygonState: {
    points: Array<PolygonSegment<GeometryRelativeSheetPosition>>;
  } | null = null;
  private originalPolygonFillColor: FillColorComponent[keyof FillColorComponent] | undefined = null;
  /** Stores all locked point segments that move together (includes the dragged point). */
  private lockedPoints: Array<{ polygonId: Id; segmentIndex: number }> = [];
  /** Stores the original polygon state for each locked polygon for restore on cancel. */
  private originalLockedPolygonStates: Map<
    Id,
    Array<PolygonSegment<GeometryRelativeSheetPosition>>
  > = new Map();

  /** Constrained track result for the current drag operation. `'unconstrained'` when no constraints
   *  apply, `'immobile'` when constraints are contradictory, or an array of tracks to snap to. */
  private draggingConstrainedTrackResult = ConstrainedTrackPath.Unconstrained;

  /** Explicitly selected entity IDs for the current move drag (excludes implicit filter followers). */
  private draggingMoveIds: Array<Id> = [];

  private draggingGeometryIds: Array<Id> | null = null;
  /** Resize mode when resizing via bounding box handles. */
  private resizeMode: ResizeMode | null = null;
  /** Original layout states for all geometries being resized, for restoring on cancel. */
  private resizeOriginalGroupStates: Map<Id, DragState> | null = null;
  /** Original entities (with full components like FillColorComponent) for correct history. */
  private resizeOriginalEntities: Map<Id, Entity> | null = null;
  /** Original oriented selection frame at start of resize. */
  private resizeOriginalFrame: SelectionResizeFrame | null = null;
  /** Active rotation-handle drag state. */
  private activeRotationDrag: {
    geometryId: Id;
    beforeRotation: ReturnType<typeof RotationComponent.get>;
    pivot: SheetPosition;
    startPointerAngleRadians: number;
  } | null = null;
  /** Full original geometries for each locked point, used for anchor compensation / cancel. */
  private originalVertexGeometries: Map<Id, Entity> = new Map();

  /** The initial position the user clicked when clicking on a constraint label. Used to determine
   * if the user just clicked, or clicked and dragged (which moves the label). */
  private constraintLabelPointerDownPosition: ScreenPosition | null = null;

  /** When set, the tool is in "pick an entity" mode. While active it takes precedence over all other
   * select-tool mouse handling: hovering a geometry highlights it and clicking one invokes the
   * stored callback with that geometry's id. */
  private entityPick: { onSelect: (id: Id) => void } | null = null;

  /** Enters interactive entity-pick mode, replacing any existing pick session. */
  beginEntityPick(onSelect: (id: Id) => void): void {
    this.cancelActiveDrag();
    this.cancelTooltip();
    this.entityPick = { onSelect };
    this.emit('entityPickBegin');
  }

  /** Leaves entity-pick mode and clears any highlight. When called without an entity id, cancels
   * the currently active entity pick operation. */
  endEntityPick(entityId?: Entity['id']): void {
    if (!this.entityPick) {
      return;
    }

    const { onSelect } = this.entityPick;
    this.entityPick = null;
    this.highlightGeometry(null);
    this.emit('entityPickEnd', entityId ?? null);

    if (typeof entityId !== 'undefined') {
      onSelect(entityId);
    }
  }

  handleToolBlur(): void {
    this.endEntityPick();
    this.getSelectionManager().clearSelection();
    this.emit('hoveringPolygonSegmentChange', false);
    this.emit('hoveringConstraintLabelChange', null);
    this.cancelTooltip();
    this.highlightGeometry(null);
  }

  dragSelectBoundingBox: Rect<SheetPosition> | null = null;
  private dragSelectBoundingBoxTranslateStart: SheetPosition | null = null;

  /** The last sheet position computed in the onMove handler during a drag-select operation. Updated
   * on every move. Used to capture the mouse position when space is pressed for translation. */
  private dragSelectLatestSheetPos: SheetPosition | null = null;

  /** The sheet position of the mouse at the moment space was pressed during drag-select. Used as the
   * anchor for computing translation deltas. */
  private dragSelectTranslateMouseAnchor: SheetPosition | null = null;

  /** Replaces the closure variable `startSheetPosition` in handleBackdropPointerDown. Set on pointer
   * down, updated on space release so that resize continues from the correct anchor after translate. */
  private dragSelectStartSheetPos: SheetPosition | null = null;

  handleBackdropPointerDown(screenPos: ScreenPosition, viewportControls: ViewportControls): void {
    // While picking an entity, a backdrop click just cancels the pick.
    if (this.entityPick) {
      this.endEntityPick();
      return;
    }

    if (this.dragSelectBoundingBox) {
      this.dragSelectBoundingBox = null;
      this.emit('dragSelectBoundingBoxChange', null);
      return;
    }

    this.dragSelectStartSheetPos = screenPos.toSheet(viewportControls.getState().viewport);

    this.dragSelectBoundingBox = { position: this.dragSelectStartSheetPos, width: 0, height: 0 };
    this.emit('dragSelectBoundingBoxChange', this.dragSelectBoundingBox);

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const endSheetPosition = sp.toSheet(viewportControls.getState().viewport);
        this.dragSelectLatestSheetPos = endSheetPosition;
        if (
          this.dragSelectBoundingBoxTranslateStart &&
          this.dragSelectBoundingBox &&
          this.dragSelectTranslateMouseAnchor
        ) {
          const dx = endSheetPosition.x - this.dragSelectTranslateMouseAnchor.x;
          const dy = endSheetPosition.y - this.dragSelectTranslateMouseAnchor.y;
          this.dragSelectBoundingBox = {
            position: new SheetPosition(
              this.dragSelectBoundingBoxTranslateStart.x + dx,
              this.dragSelectBoundingBoxTranslateStart.y + dy,
            ),
            width: this.dragSelectBoundingBox.width,
            height: this.dragSelectBoundingBox.height,
          };
        } else {
          this.dragSelectBoundingBox = BoundingBox.fromPoints([
            this.dragSelectStartSheetPos!,
            endSheetPosition,
          ]) as Rect<SheetPosition>;
        }

        const selectedIds = new Set<Entity['id']>();
        for (const geometry of this.getGeometryStore().listRenderableGeometries()) {
          const bbox = Entity.boundingBoxInSheet(geometry);
          if (BoundingBox.contains(this.dragSelectBoundingBox, bbox)) {
            selectedIds.add(geometry.id);
          }
        }
        this.getSelectionManager().clearSelection().selectAll(selectedIds);

        this.emit('dragSelectBoundingBoxChange', this.dragSelectBoundingBox);
      },
      onCommit: () => {
        this.dragSelectBoundingBox = null;
        this.dragSelectLatestSheetPos = null;
        this.dragSelectTranslateMouseAnchor = null;
        this.dragSelectBoundingBoxTranslateStart = null;
        this.dragSelectStartSheetPos = null;
        this.emit('dragSelectBoundingBoxChange', null);
      },
      onCancel: () => {
        this.dragSelectBoundingBox = null;
        this.dragSelectLatestSheetPos = null;
        this.dragSelectTranslateMouseAnchor = null;
        this.dragSelectBoundingBoxTranslateStart = null;
        this.dragSelectStartSheetPos = null;
        this.emit('dragSelectBoundingBoxChange', null);
      },
    });
  }

  /** Called by the renderer when the pointer enters the fill area of a shape. */
  handleGeometryFillEnter(id: Id): void {
    if (this.entityPick) {
      this.highlightGeometry(id);
      return;
    }
    this.scheduleTooltip('geometry-fill', GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS);
  }

  /** Called by the renderer when the pointer leaves the fill area of a shape. */
  handleGeometryFillLeave(_id: Id): void {
    if (this.entityPick) {
      this.highlightGeometry(null);
      return;
    }
    this.cancelTooltip();
  }

  /**
   * Cancels the active drag operation and restores the polygon to its original state.
   * @internal
   **/
  cancelActiveDrag(): void {
    if (this.activeDragListener) {
      this.activeDragListener.destroy();
    }
  }

  /** Clears all drag state and emits dragStateChange(null). */
  private clearDragState(): void {
    this.draggingPolygonId = null;
    this.draggingSegmentIndex = -1;
    this.draggingPointKey = '';
    this.dragStartSheetPos = null;
    this.initialDragStateChangeEmitted = false;
    this.originalPolygonState = null;
    this.lockedPoints = [];
    this.originalLockedPolygonStates.clear();
    this.draggingConstrainedTrackResult = ConstrainedTrackPath.Unconstrained;
    this.draggingMoveIds = [];
    this.resizeMode = null;
    this.draggingGeometryIds = null;
    this.resizeOriginalGroupStates = null;
    this.resizeOriginalEntities = null;
    this.resizeOriginalFrame = null;
    this.activeRotationDrag = null;
    this.originalVertexGeometries.clear();
    this.emit('dragStateChange', null);
  }

  /** Handles key down events for polygon drawing and select tool shortcuts. */
  handleKeyDown(event: KeyboardEvent): boolean {
    // Escape cancels an in-progress entity pick.
    if (event.key === 'Escape' && this.entityPick) {
      this.endEntityPick();
      return true;
    }

    // Escape clears selection / active drag
    if (event.key === 'Escape') {
      if (this.activeDragListener) {
        this.cancelActiveDrag();
        return true;
      }
      this.getGeometryStore().clearWorkingConstraints();
      this.onFilterLabelLengthInputDismiss();
      this.getSelectionManager().clearSelection();
      return true;
    }

    // Backspace deletes a geometry
    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.deleteSelectedGeometry();
      return true;
    }

    // Pressing enter while working constraints are visible syncs their values back to the
    // constraint they each shadow
    if (event.key === 'Enter') {
      const selectedIds = this.getSelectionManager().getSelectedIds();
      if (selectedIds.every((id) => id.startsWith(ID_PREFIXES.constraint))) {
        this.getHistoryManager().applyTransaction('sync-working-constraint-length', () => {
          const workingConstraints = this.getGeometryStore().workingConstraints;
          for (const constraintId of selectedIds) {
            const wc = workingConstraints.find((wc) => wc.shadowsConstraintId === constraintId);
            if (!wc) {
              continue;
            }

            switch (wc.type) {
              case 'linear':
                if (wc.constrainedLength === null) {
                  continue;
                }
                this.getGeometryStore().updateByIdWithComponent(
                  constraintId,
                  ConstraintComponent,
                  (g) =>
                    ConstraintComponent.update(g, { constrainedLength: wc.constrainedLength! }),
                );
                break;
            }
          }
        });
        this.getGeometryStore().clearWorkingConstraints();
        return true;
      }
      if (selectedIds.every((id) => id.startsWith(ID_PREFIXES.filter))) {
        this.onFilterLabelLengthInputAccept();
        return true;
      }
    }

    if (event.key === ' ' && this.dragSelectBoundingBox && this.dragSelectLatestSheetPos) {
      this.dragSelectBoundingBoxTranslateStart = new SheetPosition(
        this.dragSelectBoundingBox.position.x,
        this.dragSelectBoundingBox.position.y,
      );
      this.dragSelectTranslateMouseAnchor = new SheetPosition(
        this.dragSelectLatestSheetPos.x,
        this.dragSelectLatestSheetPos.y,
      );
      return true;
    }

    return false;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
    if (event.key === ' ' && this.dragSelectBoundingBox) {
      this.dragSelectBoundingBoxTranslateStart = null;
      this.dragSelectTranslateMouseAnchor = null;

      // After translation, recompute the resize anchor to be the opposite corner of the box from
      // the current mouse position, so that resize continues from the correct anchor point
      if (this.dragSelectLatestSheetPos) {
        const { position, width: w, height: h } = this.dragSelectBoundingBox;
        const mouse = this.dragSelectLatestSheetPos;
        this.dragSelectStartSheetPos = new SheetPosition(
          mouse.x < position.x + w / 2 ? position.x + w : position.x,
          mouse.y < position.y + h / 2 ? position.y + h : position.y,
        );
      }

      return true;
    }
    return false;
  }

  /** Current closest point to segment for tooltip display. */
  private currentClosestPoint: {
    polygonId: Id;
    segmentIndex: number;
    point: SheetPosition;
  } | null = null;

  /** Handles mouse move to compute closest point on selected polygon edges for tooltip. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (this.entityPick) {
      return;
    }

    this.restartTooltip('geometry-fill', GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS);

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const selectedIds = this.getSelectionManager().getSelectedIds();
    let newClosestPoint: { polygonId: Id; segmentIndex: number; point: SheetPosition } | null =
      null;
    let minDist = Infinity;

    for (const id of selectedIds) {
      const geom = this.getGeometryStore().getByIdWithComponent(id, GeometryComponent);
      if (!geom || !GeometryComponent.isPolygon(geom)) continue;

      const polygonData = GeometryComponent.get(geom);
      const points = PolygonData.renderedSegments(geom);
      const pointCount = points.length;
      if (pointCount < 2) continue;

      // For closed polygons, we iterate all points (the last point connects back to the first).
      // For open polygons, we iterate up to the second-to-last point (the last point has no outgoing edge).
      const lastEdgeIndex = polygonData.closed ? pointCount - 1 : pointCount - 2;

      for (let i = 0; i <= lastEdgeIndex; i++) {
        const currentSeg = points[i];
        const nextSegIndex = (i + 1) % pointCount;
        const nextSeg = points[nextSegIndex];

        let closest;
        if (nextSeg.type === 'arc-quadratic') {
          // Quadratic curve: the curve goes from currentSeg.point to nextSeg.point with nextSeg.controlPoint
          const curve = {
            start: currentSeg.point,
            controlPoint: nextSeg.controlPoint,
            end: nextSeg.point,
          };
          closest = closestPointOnQuadraticCurve(curve, sheetPos);
        } else if (nextSeg.type === 'arc-cubic') {
          // Cubic curve: the curve goes from currentSeg.point to nextSeg.point with two control points
          const curve = {
            start: currentSeg.point,
            controlPointA: nextSeg.controlPointA,
            controlPointB: nextSeg.controlPointB,
            end: nextSeg.point,
          };
          closest = closestPointOnCubicCurve(curve, sheetPos);
        } else {
          // Line segment: from currentSeg.point to nextSeg.point
          closest = closestPointOnSegment(currentSeg.point, nextSeg.point, sheetPos);
        }

        if (closest.distance < minDist) {
          minDist = closest.distance;
          newClosestPoint = { polygonId: id, segmentIndex: i, point: closest.point };
        }
      }
    }

    if (
      newClosestPoint?.polygonId !== this.currentClosestPoint?.polygonId ||
      newClosestPoint?.segmentIndex !== this.currentClosestPoint?.segmentIndex ||
      newClosestPoint?.point.x !== this.currentClosestPoint?.point.x ||
      newClosestPoint?.point.y !== this.currentClosestPoint?.point.y
    ) {
      this.currentClosestPoint = newClosestPoint;
      this.emit('closestPointToSegmentChange', newClosestPoint);
    }
  }

  /** Starts dragging a vertex handle. Called from renderer pointer down on vertex handles. */
  onVertexPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    polygonId: Id,
    segmentIndex: number,
  ) {
    const polygonGeom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    if (!polygonGeom || !GeometryComponent.isPolygon(polygonGeom)) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const polygonData = GeometryComponent.get(polygonGeom);
    const renderedPoints = PolygonData.renderedSegments(polygonGeom);
    const beforeRenderedPoint = renderedPoints[segmentIndex].point;

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = 'vertex';
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygonData.points.slice() };
    this.originalPolygonFillColor = FillColorComponent.getOptional(polygonGeom);

    this.lockedPoints = [{ polygonId, segmentIndex }];
    this.originalLockedPolygonStates.clear();
    this.originalLockedPolygonStates.set(polygonId, polygonData.points.slice());
    this.originalVertexGeometries.clear();
    this.originalVertexGeometries.set(polygonId, polygonGeom);

    const matchingPoints = this.getGeometryStore().findMatchingPoints(
      beforeRenderedPoint,
      polygonId,
    );
    for (const match of matchingPoints) {
      this.lockedPoints.push({ polygonId: match.polygonId, segmentIndex: match.segmentIndex });
      const otherGeom = this.getGeometryStore().getByIdWithComponent(
        match.polygonId,
        GeometryComponent,
      );
      if (otherGeom && GeometryComponent.isPolygon(otherGeom)) {
        this.originalLockedPolygonStates.set(
          match.polygonId,
          GeometryComponent.get(otherGeom).points.slice(),
        );
        this.originalVertexGeometries.set(match.polygonId, otherGeom);
      }
    }

    // Find constraints attached to this vertex via locked-polygon endpoints
    const matchedConstraints = this.getGeometryStore().getConstraintsWherePointMatches((pt) => {
      return pt.type === 'locked-polygon' && pt.id === polygonId && pt.pointIndex === segmentIndex;
    });

    const sheetConfig = this.getSheet();
    if (matchedConstraints.length > 0 && sheetConfig) {
      const result = Constraint.computeConstrainedTracksForPoints(
        matchedConstraints,
        [beforeRenderedPoint],
        sheetConfig.defaultUnit,
        (ep) => this.getGeometryStore().resolveConstraintEndpoint(ep),
        sheetConfig.epsilon,
      );
      if (result.type !== 'unconstrained') {
        this.draggingConstrainedTrackResult = result;
      }
    }

    this.emit('dragStateChange', { type: 'polygon-point', polygonId });

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnappingOnConstrainedTrack(
          sheet,
          this.draggingConstrainedTrackResult,
          {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
            selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(polygonId),
            viewportScale: liveViewport.scale,
          },
          this.getSheet()?.epsilon ?? 0.001,
        );
        // Move points which render at the same position using each target's own inverse render
        // transform. This keeps locked points together even when their rotations / anchors differ.
        for (const locked of this.lockedPoints) {
          const originalGeometry = this.originalVertexGeometries.get(locked.polygonId);
          if (
            !originalGeometry ||
            !Entity.hasComponent(originalGeometry, GeometryComponent) ||
            GeometryComponent.get(originalGeometry).type !== 'polygon'
          ) {
            continue;
          }
          const originalPolygon = originalGeometry as Entity<GeometryComponent<PolygonData>>;

          this.getGeometryStore().updateByIdDirect(locked.polygonId, (prev) => {
            if (
              !Entity.hasComponent(prev, GeometryComponent) ||
              !GeometryComponent.isPolygon(prev)
            ) {
              return prev;
            }
            const prevData = GeometryComponent.get(prev);
            const snappedRawAbsolute = renderedPointToRaw(originalPolygon, snapped);
            const snappedLocal = new GeometryRelativeSheetPosition(
              snappedRawAbsolute.x - prevData.position.x,
              snappedRawAbsolute.y - prevData.position.y,
            );
            const points = prevData.points.slice();
            const isFirstPointAndAtSamePositionAsLastPoint =
              locked.segmentIndex === 0 &&
              points.at(-1)?.point.x === points[0].point.x &&
              points.at(-1)?.point.y === points[0].point.y;

            points[locked.segmentIndex] = {
              ...points[locked.segmentIndex],
              point: snappedLocal,
            };

            if (isFirstPointAndAtSamePositionAsLastPoint) {
              points[points.length - 1] = { ...points[points.length - 1], point: snappedLocal };
            }

            const originalRawPoint =
              PolygonData.rawSegments(originalPolygon)[locked.segmentIndex].point;
            let updated = GeometryComponent.update(prev, { points }) as Entity<
              GeometryComponent & Partial<AnchorPointComponent>
            >;
            updated = compensateAnchorForMovedKeyPoint(originalPolygon, updated, originalRawPoint);

            if (locked.polygonId === this.draggingPolygonId) {
              const [output] = FilterComponent.syncFillColor(
                updated,
                this.getGeometryStore().findFiltersByGeometryId(updated.id),
              );
              return output;
            }
            return updated;
          });
        }
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId) {
          const moves: Array<{
            id: Id;
            segmentIndex: number;
            beforePoint: SheetPosition;
            afterPoint: SheetPosition;
          }> = [];
          const anchorEntries: Array<UndoEntry> = [];

          for (const locked of this.lockedPoints) {
            const originalPoints = this.originalLockedPolygonStates.get(locked.polygonId);
            const originalGeometry = this.originalVertexGeometries.get(locked.polygonId);
            const currentGeometry = this.getGeometryStore().getByIdWithComponent(
              locked.polygonId,
              GeometryComponent,
            );
            if (
              !originalPoints ||
              !originalGeometry ||
              !currentGeometry ||
              !GeometryComponent.isPolygon(currentGeometry)
            ) {
              continue;
            }
            const currentPoints = GeometryComponent.get(currentGeometry).points;

            if (
              Entity.hasComponent(originalGeometry, AnchorPointComponent) &&
              Entity.hasComponent(currentGeometry, AnchorPointComponent)
            ) {
              const beforeAnchor = AnchorPointComponent.get(originalGeometry);
              const afterAnchor = AnchorPointComponent.get(currentGeometry);
              if (
                beforeAnchor.keyPoint !== afterAnchor.keyPoint ||
                beforeAnchor.offset.x !== afterAnchor.offset.x ||
                beforeAnchor.offset.y !== afterAnchor.offset.y
              ) {
                anchorEntries.push(
                  UndoEntry.anchorPointMove(locked.polygonId, beforeAnchor, afterAnchor),
                );
              }
            }

            if (originalPoints[locked.segmentIndex]?.type !== 'point') {
              continue;
            }
            const beforeLocal = originalPoints[locked.segmentIndex].point;
            const beforeLockedPoint = new SheetPosition(beforeLocal.x, beforeLocal.y);
            const afterLocal = currentPoints[locked.segmentIndex]?.point;
            if (!afterLocal) {
              continue;
            }
            const afterPoint = new SheetPosition(afterLocal.x, afterLocal.y);
            if (beforeLockedPoint.x === afterPoint.x && beforeLockedPoint.y === afterPoint.y) {
              continue;
            }

            moves.push({
              id: locked.polygonId,
              segmentIndex: locked.segmentIndex,
              beforePoint: beforeLockedPoint,
              afterPoint,
            });

            if (locked.segmentIndex === 0 && originalPoints.length > 1) {
              const originalLast = originalPoints.at(-1)?.point;
              const currentLast = currentPoints.at(-1)?.point;
              if (
                originalLast &&
                currentLast &&
                originalLast.x === beforeLockedPoint.x &&
                originalLast.y === beforeLockedPoint.y
              ) {
                moves.push({
                  id: locked.polygonId,
                  segmentIndex: originalPoints.length - 1,
                  beforePoint: beforeLockedPoint,
                  afterPoint: new SheetPosition(currentLast.x, currentLast.y),
                });
              }
            }
          }

          if (moves.length > 0 || anchorEntries.length > 0) {
            this.getHistoryManager().applyTransaction(
              'polygon-vertex-move',
              () => {
                for (const entry of anchorEntries) {
                  this.getHistoryManager().push(entry);
                }
                if (moves.length > 1) {
                  this.getHistoryManager().push(UndoEntry.polygonMoveMultipleVertices(moves));
                } else if (moves.length === 1) {
                  const move = moves[0];
                  this.getHistoryManager().push(
                    UndoEntry.polygonMoveVertex(
                      move.id,
                      move.segmentIndex,
                      move.beforePoint,
                      move.afterPoint,
                    ),
                  );
                }

                // After moving a filter endpoint, resync the filled state of any associated geometries
                this.getGeometryStore().updateByIdWithComponentDirect(
                  this.draggingPolygonId!,
                  GeometryComponent,
                  (geometry) => {
                    const [output, historyEvents] = FilterComponent.syncFillColor(
                      geometry,
                      this.getGeometryStore().findFiltersByGeometryId(geometry.id),
                      polygonGeom,
                    );
                    if (output !== geometry) {
                      for (const event of historyEvents) {
                        this.getHistoryManager().push(event);
                      }
                    }
                    return output;
                  },
                );
              },
              { collapseIfSingle: true },
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        for (const locked of this.lockedPoints) {
          const originalState = this.originalLockedPolygonStates.get(locked.polygonId);
          const originalGeometry = this.originalVertexGeometries.get(locked.polygonId);
          if (!originalState || !originalGeometry) {
            continue;
          }
          const isMain = locked.polygonId === this.draggingPolygonId;
          this.getGeometryStore().updateByIdDirect(locked.polygonId, (prev) => {
            if (
              !Entity.hasComponent(prev, GeometryComponent) ||
              !GeometryComponent.isPolygon(prev)
            ) {
              return prev;
            }

            let updated = GeometryComponent.update(prev, {
              points: originalState.slice(),
            }) as Entity<
              GeometryComponent & Partial<AnchorPointComponent> & Partial<FillColorComponent>
            >;

            if (Entity.hasComponent(originalGeometry, AnchorPointComponent)) {
              updated = AnchorPointComponent.update(
                updated as Entity<AnchorPointComponent>,
                AnchorPointComponent.get(
                  originalGeometry as Entity<GeometryComponent & AnchorPointComponent>,
                ),
              ) as typeof updated;
            }

            if (isMain) {
              if (typeof this.originalPolygonFillColor !== 'undefined') {
                return FillColorComponent.update(updated, this.originalPolygonFillColor);
              }
              return FillColorComponent.remove(updated);
            }
            return updated;
          });
        }

        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts dragging a control point handle. Called from renderer pointer down on control handles. */
  onControlPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    polygonId: Id,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
  ): void {
    const geom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    if (!geom || !GeometryComponent.isPolygon(geom)) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const ctrlPolygonData = GeometryComponent.get(geom);
    const originalGeometry = geom as Entity<GeometryComponent & Partial<AnchorPointComponent>>;
    let beforeLocalPoint: GeometryRelativeSheetPosition;
    if (pointKey === 'controlPoint') {
      beforeLocalPoint = (
        ctrlPolygonData.points[
          segmentIndex
        ] as QuadraticBezierSegment<GeometryRelativeSheetPosition>
      ).controlPoint;
    } else {
      beforeLocalPoint = (
        ctrlPolygonData.points[segmentIndex] as CubicBezierSegment<GeometryRelativeSheetPosition>
      )[pointKey];
    }
    const beforePoint = new SheetPosition(beforeLocalPoint.x, beforeLocalPoint.y);

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = pointKey;
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: ctrlPolygonData.points.slice() };
    this.emit('dragStateChange', { type: 'polygon-curve-control-point', polygonId });

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          ctrlHeld: this.toolManager.getCtrlHeld(),
          superHeld: false,
          selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(polygonId),
          viewportScale: liveViewport.scale,
        });

        this.getGeometryStore().updateByIdDirect(this.draggingPolygonId, (prev) => {
          if (!Entity.hasComponent(prev, GeometryComponent) || !GeometryComponent.isPolygon(prev)) {
            return prev;
          }
          const prevData = GeometryComponent.get(prev);
          const segments = prevData.points.slice();
          const snappedRawAbsolute = renderedPointToRaw(originalGeometry, snapped);
          const snappedLocal = new GeometryRelativeSheetPosition(
            snappedRawAbsolute.x - prevData.position.x,
            snappedRawAbsolute.y - prevData.position.y,
          );
          if (this.draggingPointKey === 'controlPoint') {
            const seg = segments[
              this.draggingSegmentIndex
            ] as QuadraticBezierSegment<GeometryRelativeSheetPosition>;
            segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snappedLocal };
          } else {
            const seg = segments[
              this.draggingSegmentIndex
            ] as CubicBezierSegment<GeometryRelativeSheetPosition>;
            segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snappedLocal };
          }
          return GeometryComponent.update(prev, { points: segments }) as Entity;
        });
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterRawAbsolute = renderedPointToRaw(
          originalGeometry,
          applySnapping(world.toSheet(), {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
            selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(polygonId),
            viewportScale: liveViewport.scale,
          }),
        );
        const afterPoint = new SheetPosition(
          afterRawAbsolute.x - ctrlPolygonData.position.x,
          afterRawAbsolute.y - ctrlPolygonData.position.y,
        );
        if (
          this.draggingPolygonId &&
          (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)
        ) {
          this.getHistoryManager().push(
            UndoEntry.polygonMoveControlPoint(
              this.draggingPolygonId,
              this.draggingSegmentIndex,
              pointKey,
              beforePoint,
              afterPoint,
            ),
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          this.getGeometryStore().updateByIdDirect(this.draggingPolygonId, (prev) => {
            if (
              !Entity.hasComponent(prev, GeometryComponent) ||
              !GeometryComponent.isPolygon(prev)
            ) {
              return prev;
            }
            return GeometryComponent.update(prev, {
              points: this.originalPolygonState!.points.slice(),
            }) as Entity;
          });
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /**
   * Starts dragging a geometry's anchor point handle. The anchor point is stored as an offset (in
   * sheet units) from the geometry's natural origin, so the handle is moved by updating the
   * {@link AnchorPointComponent} rather than the underlying geometry.
   */
  onAnchorPointPointerDown(
    _screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    geometryId: Id,
  ) {
    const geometry = this.getGeometryStore().getByIdWithComponent(geometryId, AnchorPointComponent);
    if (!geometry) {
      return;
    }

    const beforeHandlePosition = AnchorPointComponent.getHandlePosition(geometry);
    const before = AnchorPointComponent.get(geometry);
    const filters = this.getGeometryStore().findFiltersByGeometryId(geometryId);
    const angleDegrees = RotationComponent.getOptional(geometry)?.angle.toDegrees().magnitude ?? 0;
    const adapter = TransformableTemplate.getForEntity(geometry);

    let lastDeltaX = 0,
      lastDeltaY = 0;

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const snapped = applySnapping(sp.toWorld(liveViewport).toSheet(), {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          ctrlHeld: this.toolManager.getCtrlHeld(),
          superHeld: false,
          selectedGeometryFilters: filters,
          viewportScale: liveViewport.scale,
        });

        this.getGeometryStore().updateByIdWithComponentDirect(
          geometryId,
          AnchorPointComponent,
          (g) => {
            const deltaX = snapped.x - beforeHandlePosition.x;
            const deltaY = snapped.y - beforeHandlePosition.y;
            const rawOffsetDelta = rotatePointAround(
              new SheetPosition(deltaX, deltaY),
              new SheetPosition(0, 0),
              -angleDegrees,
            );
            const updated = AnchorPointComponent.update(g, {
              keyPoint: before.keyPoint,
              offset: new SheetPosition(
                before.offset.x + rawOffsetDelta.x,
                before.offset.y + rawOffsetDelta.y,
              ),
            });
            const translate = (entity: Entity) =>
              adapter
                ? (adapter.translate?.(
                    entity,
                    (prev) =>
                      new SheetPosition(prev.x - lastDeltaX + deltaX, prev.y - lastDeltaY + deltaY),
                  ) ?? entity)
                : Entity.hasComponent(entity, GeometryComponent)
                  ? GeometryComponent.transform(
                      entity,
                      (prev) =>
                        new SheetPosition(
                          prev.x - lastDeltaX + deltaX,
                          prev.y - lastDeltaY + deltaY,
                        ),
                    )
                  : entity;
            const output = translate(updated) as typeof g;
            lastDeltaX = deltaX;
            lastDeltaY = deltaY;
            return output;
          },
        );
      },
      onCommit: () => {
        const afterGeometry = this.getGeometryStore().getByIdWithComponent(
          geometryId,
          AnchorPointComponent,
        );
        if (!afterGeometry) {
          this.activeDragListener = null;
          return;
        }
        const after = AnchorPointComponent.get(afterGeometry);
        if (before.offset.x !== after.offset.x || before.offset.y !== after.offset.y) {
          const forwardsActions: Array<UndoEntry> = [
            UndoEntry.anchorPointMove(geometryId, before, after),
          ];
          if (Entity.hasComponent(afterGeometry, GeometryComponent)) {
            const move = this.buildMoveUndoEntry(geometry, afterGeometry);
            if (move) {
              forwardsActions.push(move);
            }
          } else {
            const afterAdapter = TransformableTemplate.getForEntity(afterGeometry);
            if (afterAdapter?.createMoveUndoEntry) {
              forwardsActions.push(
                afterAdapter.createMoveUndoEntry(
                  geometryId,
                  afterAdapter.get(geometry),
                  afterAdapter.get(afterGeometry),
                ) as UndoEntry,
              );
            }
          }
          this.getHistoryManager().push(
            UndoEntry.transaction('anchor-point-drag', forwardsActions),
          );
        }
        this.activeDragListener = null;
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(
          geometryId,
          AnchorPointComponent,
          (g) => {
            const updated = AnchorPointComponent.update(g, before);
            const translate = (entity: Entity) =>
              adapter
                ? (adapter.translate?.(
                    entity,
                    (prev) => new SheetPosition(prev.x - lastDeltaX, prev.y - lastDeltaY),
                  ) ?? entity)
                : Entity.hasComponent(entity, GeometryComponent)
                  ? GeometryComponent.transform(
                      entity,
                      (prev) => new SheetPosition(prev.x - lastDeltaX, prev.y - lastDeltaY),
                    )
                  : entity;
            return translate(updated) as typeof g;
          },
        );
        this.activeDragListener = null;
      },
    });
  }

  /**
   * Builds a single raw ConstrainedTrack from a constraint where exactly one endpoint is attached
   * to the given geometry ID. Returns the raw track (in the constrained endpoint's own coordinate
   * space), the resolved position of the shape's endpoint, and the shape endpoint itself.
   * Returns null when the constraint does not apply (both/neither attached, unresolvable, etc.).
   */
  private buildSingleConstrainedTrack(
    c: Entity<ConstraintComponent>,
    geometryId: Id,
    sheetUnit: UnitType,
    excludeConstraintsAttachedToGeometryIds: Array<Entity['id']> = [],
  ): {
    track: ConstrainedTrack;
    endpointPos: SheetPosition;
    shapeEndpoint: ConstraintEndpoint;
  } | null {
    const constraint = ConstraintComponent.get(c);
    switch (constraint.type) {
      case 'linear': {
        if (constraint.constrainedLength === null) {
          return null;
        }

        // If a constraint is attached to an excluded endpoint, then it shouldn't take effect
        //
        // Example case where this is used: three geometries are all selected and are being moved
        // together with constraints all internally between them all.
        const excluded = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        if (excluded(constraint.pointA) || excluded(constraint.pointB)) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        // Skip if both or neither are attached - no single moving endpoint
        if (aAttached === bAttached) {
          return null;
        }

        const shapeEndpoint = aAttached ? constraint.pointA : constraint.pointB;
        const fixedEndpoint = aAttached ? constraint.pointB : constraint.pointA;

        const store = this.getGeometryStore();
        const endpointPos = store.resolveConstraintEndpoint(shapeEndpoint);
        const fixedPos = store.resolveConstraintEndpoint(fixedEndpoint);
        if (!endpointPos || !fixedPos) {
          return null;
        }

        const radius = constraint.constrainedLength.toSheetUnits(sheetUnit).magnitude;

        if (constraint.axis === 'x') {
          // |dx| = constrainedLength → two vertical lines
          return {
            track: {
              type: 'or' as const,
              inner: [
                {
                  type: 'line' as const,
                  point: new SheetPosition(fixedPos.x - radius, fixedPos.y),
                  slope: Infinity,
                },
                {
                  type: 'line' as const,
                  point: new SheetPosition(fixedPos.x + radius, fixedPos.y),
                  slope: Infinity,
                },
              ],
            },
            endpointPos,
            shapeEndpoint,
          };
        }
        if (constraint.axis === 'y') {
          // |dy| = constrainedLength → two horizontal lines
          return {
            track: {
              type: 'or' as const,
              inner: [
                {
                  type: 'line' as const,
                  point: new SheetPosition(fixedPos.x, fixedPos.y - radius),
                  slope: 0,
                },
                {
                  type: 'line' as const,
                  point: new SheetPosition(fixedPos.x, fixedPos.y + radius),
                  slope: 0,
                },
              ],
            },
            endpointPos,
            shapeEndpoint,
          };
        }

        return {
          track: { type: 'circle' as const, center: fixedPos, radius },
          endpointPos,
          shapeEndpoint,
        };
      }

      case 'horizontal': {
        // If any endpoint is on another geometry being dragged, skip — the constraint
        // is internally satisfied by the rigid translation of the whole group.
        const excluded = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
        if (excluded(constraint.pointA) || excluded(constraint.pointB)) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        if (aAttached === bAttached) {
          return null;
        }

        const shapeEndpoint = aAttached ? constraint.pointA : constraint.pointB;
        const fixedEndpoint = aAttached ? constraint.pointB : constraint.pointA;

        const store = this.getGeometryStore();
        const endpointPos = store.resolveConstraintEndpoint(shapeEndpoint);
        const fixedPos = store.resolveConstraintEndpoint(fixedEndpoint);
        if (!endpointPos || !fixedPos) {
          return null;
        }

        return {
          track: { type: 'line', point: fixedPos, slope: 0 },
          endpointPos,
          shapeEndpoint,
        };
      }

      case 'vertical': {
        // If any endpoint is on another geometry being dragged, skip.
        const excluded = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
        if (excluded(constraint.pointA) || excluded(constraint.pointB)) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        if (aAttached === bAttached) {
          return null;
        }

        const shapeEndpoint = aAttached ? constraint.pointA : constraint.pointB;
        const fixedEndpoint = aAttached ? constraint.pointB : constraint.pointA;

        const store = this.getGeometryStore();
        const endpointPos = store.resolveConstraintEndpoint(shapeEndpoint);
        const fixedPos = store.resolveConstraintEndpoint(fixedEndpoint);
        if (!endpointPos || !fixedPos) {
          return null;
        }

        return {
          track: { type: 'line', point: fixedPos, slope: Infinity },
          endpointPos,
          shapeEndpoint,
        };
      }

      case 'colinear': {
        // If any endpoint is on another geometry being dragged, skip.
        const excluded = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
        if (
          excluded(constraint.pointTarget) ||
          excluded(constraint.pointA) ||
          excluded(constraint.pointB)
        ) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const targetAttached = attached(constraint.pointTarget);
        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        const movingCount = [targetAttached, aAttached, bAttached].filter(Boolean).length;

        // 0 or 3 attached: no net positional constraint
        if (movingCount === 0 || movingCount === 3) {
          return null;
        }

        const store = this.getGeometryStore();

        // 2 endpoints attached to the same moving geometry — they move rigidly together,
        // so their relative vector is constant. The constraint reduces to the moving
        // pair passing through the single fixed point.
        if (movingCount === 2) {
          if (aAttached && bAttached) {
            // Both segment endpoints on the moving geometry; target is fixed externally.
            // The line through A and B must pass through the fixed target.
            const endpointPos = store.resolveConstraintEndpoint(constraint.pointA);
            const resolvedA = store.resolveConstraintEndpoint(constraint.pointA);
            const resolvedB = store.resolveConstraintEndpoint(constraint.pointB);
            const fixedT = store.resolveConstraintEndpoint(constraint.pointTarget);
            if (!endpointPos || !resolvedA || !resolvedB || !fixedT) {
              return null;
            }
            const dx = resolvedB.x - resolvedA.x;
            const dy = resolvedB.y - resolvedA.y;
            return {
              track: {
                type: 'line',
                point: fixedT,
                slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
              },
              endpointPos,
              shapeEndpoint: constraint.pointA,
            };
          }
          if (aAttached && targetAttached) {
            // A and target on the moving geometry; B is fixed externally.
            // The line through A and target must pass through fixed B.
            const endpointPos = store.resolveConstraintEndpoint(constraint.pointA);
            const resolvedA = store.resolveConstraintEndpoint(constraint.pointA);
            const resolvedT = store.resolveConstraintEndpoint(constraint.pointTarget);
            const fixedB = store.resolveConstraintEndpoint(constraint.pointB);
            if (!endpointPos || !resolvedA || !resolvedT || !fixedB) {
              return null;
            }
            const dx = resolvedT.x - resolvedA.x;
            const dy = resolvedT.y - resolvedA.y;
            return {
              track: {
                type: 'line',
                point: fixedB,
                slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
              },
              endpointPos,
              shapeEndpoint: constraint.pointA,
            };
          }
          // bAttached && targetAttached: B and target on moving geometry; A is fixed.
          {
            const endpointPos = store.resolveConstraintEndpoint(constraint.pointB);
            const resolvedB = store.resolveConstraintEndpoint(constraint.pointB);
            const resolvedT = store.resolveConstraintEndpoint(constraint.pointTarget);
            const fixedA = store.resolveConstraintEndpoint(constraint.pointA);
            if (!endpointPos || !resolvedB || !resolvedT || !fixedA) {
              return null;
            }
            const dx = resolvedT.x - resolvedB.x;
            const dy = resolvedT.y - resolvedB.y;
            return {
              track: {
                type: 'line',
                point: fixedA,
                slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
              },
              endpointPos,
              shapeEndpoint: constraint.pointB,
            };
          }
        }

        // Exactly 1 endpoint attached — track is the line through the two fixed endpoints

        if (targetAttached) {
          const endpointPos = store.resolveConstraintEndpoint(constraint.pointTarget);
          const fixedA = store.resolveConstraintEndpoint(constraint.pointA);
          const fixedB = store.resolveConstraintEndpoint(constraint.pointB);
          if (!endpointPos || !fixedA || !fixedB) {
            return null;
          }
          const dx = fixedB.x - fixedA.x;
          const dy = fixedB.y - fixedA.y;
          return {
            track: {
              type: 'line',
              point: fixedA,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: constraint.pointTarget,
          };
        }

        if (aAttached) {
          const endpointPos = store.resolveConstraintEndpoint(constraint.pointA);
          const fixedTarget = store.resolveConstraintEndpoint(constraint.pointTarget);
          const fixedB = store.resolveConstraintEndpoint(constraint.pointB);
          if (!endpointPos || !fixedTarget || !fixedB) {
            return null;
          }
          const dx = fixedTarget.x - fixedB.x;
          const dy = fixedTarget.y - fixedB.y;
          return {
            track: {
              type: 'line',
              point: fixedB,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: constraint.pointA,
          };
        }

        // bAttached
        {
          const endpointPos = store.resolveConstraintEndpoint(constraint.pointB);
          const fixedTarget = store.resolveConstraintEndpoint(constraint.pointTarget);
          const fixedA = store.resolveConstraintEndpoint(constraint.pointA);
          if (!endpointPos || !fixedTarget || !fixedA) {
            return null;
          }
          const dx = fixedTarget.x - fixedA.x;
          const dy = fixedTarget.y - fixedA.y;
          return {
            track: {
              type: 'line',
              point: fixedA,
              slope: Math.abs(dx) < 1e-10 ? Infinity : dy / dx,
            },
            endpointPos,
            shapeEndpoint: constraint.pointB,
          };
        }
      }

      case 'parallel': {
        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);
        const cAttached = attached(constraint.pointC);
        const dAttached = attached(constraint.pointD);

        const movingCount = [aAttached, bAttached, cAttached, dAttached].filter(Boolean).length;
        if (movingCount !== 1) {
          return null;
        }

        const store = this.getGeometryStore();
        const resolvedA = store.resolveConstraintEndpoint(constraint.pointA);
        const resolvedB = store.resolveConstraintEndpoint(constraint.pointB);
        const resolvedC = store.resolveConstraintEndpoint(constraint.pointC);
        const resolvedD = store.resolveConstraintEndpoint(constraint.pointD);
        if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
          return null;
        }

        // The reference direction comes from the segment that is NOT being moved
        let refDx: number;
        let refDy: number;
        let fixedPoint: SheetPosition;
        let endpointPos: SheetPosition;
        let shapeEndpoint: ConstraintEndpoint;

        if (aAttached) {
          refDx = resolvedD.x - resolvedC.x;
          refDy = resolvedD.y - resolvedC.y;
          fixedPoint = resolvedB;
          endpointPos = resolvedA;
          shapeEndpoint = constraint.pointA;
        } else if (bAttached) {
          refDx = resolvedD.x - resolvedC.x;
          refDy = resolvedD.y - resolvedC.y;
          fixedPoint = resolvedA;
          endpointPos = resolvedB;
          shapeEndpoint = constraint.pointB;
        } else if (cAttached) {
          refDx = resolvedB.x - resolvedA.x;
          refDy = resolvedB.y - resolvedA.y;
          fixedPoint = resolvedD;
          endpointPos = resolvedC;
          shapeEndpoint = constraint.pointC;
        } else {
          // dAttached
          refDx = resolvedB.x - resolvedA.x;
          refDy = resolvedB.y - resolvedA.y;
          fixedPoint = resolvedC;
          endpointPos = resolvedD;
          shapeEndpoint = constraint.pointD;
        }

        return {
          track: {
            type: 'line',
            point: fixedPoint,
            slope: Math.abs(refDx) < 1e-10 ? Infinity : refDy / refDx,
          },
          endpointPos,
          shapeEndpoint,
        };
      }

      case 'perpendicular': {
        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const centerAttached = attached(constraint.pointCenter);
        const bAttached = attached(constraint.pointB);

        const movingCount = [aAttached, centerAttached, bAttached].filter(Boolean).length;
        if (movingCount !== 1) {
          return null;
        }

        const store = this.getGeometryStore();
        const resolvedA = store.resolveConstraintEndpoint(constraint.pointA);
        const resolvedCenter = store.resolveConstraintEndpoint(constraint.pointCenter);
        const resolvedB = store.resolveConstraintEndpoint(constraint.pointB);
        if (!resolvedA || !resolvedCenter || !resolvedB) {
          return null;
        }

        let endpointPos: SheetPosition;
        let shapeEndpoint: ConstraintEndpoint;
        let refDx: number;
        let refDy: number;
        // The moving point must stay on a line through the center that is perpendicular
        // to the segment from center to the OTHER non-moving endpoint
        let through: SheetPosition;

        if (aAttached) {
          refDx = resolvedB.x - resolvedCenter.x;
          refDy = resolvedB.y - resolvedCenter.y;
          through = resolvedCenter;
          endpointPos = resolvedA;
          shapeEndpoint = constraint.pointA;
        } else if (bAttached) {
          refDx = resolvedA.x - resolvedCenter.x;
          refDy = resolvedA.y - resolvedCenter.y;
          through = resolvedCenter;
          endpointPos = resolvedB;
          shapeEndpoint = constraint.pointB;
        } else {
          // centerAttached — the center is moving. Both A and B are fixed.
          // The center must lie on a circle through A and B, i.e. the set of points
          // equidistant from A and B → the perpendicular bisector of AB.
          // Actually we need to keep the distances equal — which means center stays on the
          // perpendicular bisector of A-B. That's a line.
          const midAB = {
            x: (resolvedA.x + resolvedB.x) / 2,
            y: (resolvedA.y + resolvedB.y) / 2,
          };
          const dxAB = resolvedB.x - resolvedA.x;
          const dyAB = resolvedB.y - resolvedA.y;
          return {
            track: {
              type: 'line',
              point: new SheetPosition(midAB.x, midAB.y),
              slope: Math.abs(dyAB) < 1e-10 ? Infinity : -dxAB / dyAB,
            },
            endpointPos: resolvedCenter,
            shapeEndpoint: constraint.pointCenter,
          };
        }

        // Moving point must lie on the line through `through` perpendicular to (refDx, refDy)
        return {
          track: {
            type: 'line',
            point: through,
            slope: Math.abs(refDy) < 1e-10 ? Infinity : -refDx / refDy,
          },
          endpointPos,
          shapeEndpoint,
        };
      }

      case 'coincident': {
        const excluded = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && excludeConstraintsAttachedToGeometryIds.includes(ep.id);
        if (excluded(constraint.pointA) || excluded(constraint.pointB)) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        if (aAttached === bAttached) {
          return null;
        }

        const shapeEndpoint = aAttached ? constraint.pointA : constraint.pointB;
        const fixedEndpoint = aAttached ? constraint.pointB : constraint.pointA;

        const store = this.getGeometryStore();
        const endpointPos = store.resolveConstraintEndpoint(shapeEndpoint);
        const fixedPos = store.resolveConstraintEndpoint(fixedEndpoint);
        if (!endpointPos || !fixedPos) {
          return null;
        }

        return {
          track: { type: 'point', point: fixedPos },
          endpointPos,
          shapeEndpoint,
        };
      }

      default:
        constraint satisfies never;
        throw new Error(
          `buildSingleConstrainedTrack: unexpected constraint type ${(constraint as any).type}`,
        );
    }
  }

  private buildMoveUndoEntry(before: Entity, after: Entity): UndoEntry | null {
    if (before.id !== after.id) {
      console.warn(
        `SelectTool.buildMoveUndoEntry: before.id (${before.id}) is not after.id (${after.id}), returning null...`,
      );
      return null;
    }

    if (
      Entity.hasComponent(before, GeometryComponent) &&
      Entity.hasComponent(after, GeometryComponent)
    ) {
      if (GeometryComponent.isPolygon(before) && GeometryComponent.isPolygon(after)) {
        const beforeState = GeometryComponent.get(before);
        const afterState = GeometryComponent.get(after);
        return UndoEntry.polygonMove(
          before.id,
          beforeState.points,
          afterState.points,
          beforeState.position,
          afterState.position,
        );
      } else if (GeometryComponent.isEllipse(before) && GeometryComponent.isEllipse(after)) {
        const beforeState = GeometryComponent.get(before);
        const afterState = GeometryComponent.get(after);
        return UndoEntry.ellipseMove(before.id, beforeState, afterState);
      } else if (GeometryComponent.isRectangle(before) && GeometryComponent.isRectangle(after)) {
        const beforeState = GeometryComponent.get(before);
        const afterState = GeometryComponent.get(after);
        return UndoEntry.rectangleMove(before.id, beforeState, afterState);
      }
    }

    if (Entity.hasComponent(before, DatumComponent) && Entity.hasComponent(after, DatumComponent)) {
      const beforeState = DatumComponent.get(before);
      const afterState = DatumComponent.get(after);
      // FIXME: make this history entry take just before / after, not wrapped in the object
      return UndoEntry.datumMove(before.id, { position: beforeState }, { position: afterState });
    }

    if (
      Entity.hasComponent(before, FilterComponent) &&
      Entity.hasComponent(after, FilterComponent)
    ) {
      const beforeState = FilterComponent.get(before);
      const afterState = FilterComponent.get(after);
      switch (beforeState.type) {
        case 'fillet':
        case 'chamfer':
          return null;
        case 'mirror':
          return UndoEntry.mirrorFilterMoveEndpoints(
            before.id,
            beforeState.pointA,
            beforeState.pointB,
            (afterState as typeof beforeState).pointA,
            (afterState as typeof beforeState).pointB,
          );
        case 'pattern':
          switch (beforeState.mode) {
            case 'grid':
              // This case should be a no-op, a grid filter will be moved as a frame.
              return null;
            case 'radial':
              return UndoEntry.patternRadialFilterMoveCenter(
                before.id,
                beforeState.center,
                (afterState as typeof beforeState).center,
              );
            default:
              beforeState satisfies never;
              break;
          }
          break;
        default:
          beforeState satisfies never;
          break;
      }
    }

    if (Entity.hasComponent(before, FrameComponent) && Entity.hasComponent(after, FrameComponent)) {
      const beforeState = FrameComponent.get(before);
      const afterState = FrameComponent.get(after);
      return UndoEntry.frameMove(
        before.id,
        beforeState.upperLeft,
        beforeState.lowerRight,
        afterState.upperLeft,
        afterState.lowerRight,
      );
    }

    return null;
  }

  /** Builds all undo entries needed to restore an entity after a move/resize, including any anchor
   * offset or rotation changes that accompanied the geometry change. */
  private buildTransformUndoEntries(before: Entity, after: Entity): Array<UndoEntry> {
    const entries: Array<UndoEntry> = [];
    const move = this.buildMoveUndoEntry(before, after);
    if (move) {
      entries.push(move);
    }

    if (
      Entity.hasComponent(before, AnchorPointComponent) &&
      Entity.hasComponent(after, AnchorPointComponent)
    ) {
      const beforeAnchor = AnchorPointComponent.get(before);
      const afterAnchor = AnchorPointComponent.get(after);
      if (
        beforeAnchor.keyPoint !== afterAnchor.keyPoint ||
        beforeAnchor.offset.x !== afterAnchor.offset.x ||
        beforeAnchor.offset.y !== afterAnchor.offset.y
      ) {
        entries.push(UndoEntry.anchorPointMove(before.id, beforeAnchor, afterAnchor));
      }
    }

    if (
      Entity.hasComponent(before, RotationComponent) &&
      Entity.hasComponent(after, RotationComponent)
    ) {
      const beforeRotation = RotationComponent.get(before);
      const afterRotation = RotationComponent.get(after);
      if (
        beforeRotation.angle.toDegrees().magnitude !== afterRotation.angle.toDegrees().magnitude
      ) {
        entries.push(UndoEntry.rotationChange(before.id, beforeRotation, afterRotation));
      }
    }

    return entries;
  }

  // ==================== COMMON GEOMETEY  HANDLERS ====================

  handleGeometryFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    geometryId: Id,
  ): boolean {
    return this.handleFillPointerDown(screenPos, viewportControls, geometryId);
  }

  private handleFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    entityId: Entity['id'],
  ): boolean {
    // While picking an entity, a geometry click completes the pick and is consumed.
    if (this.entityPick) {
      this.endEntityPick(entityId);
      return true;
    }

    const shiftHeld = this.toolManager.getShiftHeld();
    const ctrlHeld = this.toolManager.getCtrlHeld();
    const altHeld = this.toolManager.getAltHeld();

    // Select / deselect the clicked geometry
    if (!this.getSelectionManager().isSelected(entityId)) {
      if (this.getSelectionManager().isEmpty() || shiftHeld) {
        this.getSelectionManager().select(entityId);
      } else {
        this.getSelectionManager().clearSelection().select(entityId);
      }
    } else if (shiftHeld) {
      this.getSelectionManager().deselect(entityId);
    }

    // If selected, then translate all selected geometries
    const selectedIds = this.getSelectionManager().getSelectedIds();

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();

    // Bypass grid snap for the drag anchor when any selected geometry has constraints,
    // so constraint track offsets reference the exact mousedown position.
    const hasConstraints = selectedIds.some(
      (id) => this.getGeometryStore().findConstraintsByGeometryId(id).length > 0,
    );
    if (hasConstraints) {
      this.dragStartSheetPos = sheetPos;
    } else {
      this.dragStartSheetPos = applySnapping(sheetPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld,
        superHeld: false,
        selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(entityId),
        viewportScale: viewportControls.getState().viewport.scale,
      });
    }

    let duplicated = altHeld;
    let draggingIds: Array<Id> = [];
    this.originalDragState.clear();
    if (duplicated) {
      // If alt is held, then duplicate the polygon, and start dragging the duplicate, not the
      // original
      for (const geometry of this.getGeometryStore().getByIdsWithComponent(
        selectedIds,
        RenderOrderComponent,
      )) {
        let geometryWithoutId: Partial<
          EntityOmitComponents<typeof geometry, RenderOrderComponent>
        > = RenderOrderComponent.remove({ ...geometry });
        delete geometryWithoutId.id;
        const geometryIdPrefix = getPrefixFromId(geometry.id);
        if (!geometryIdPrefix) {
          throw new Error(
            `SelectTool.handleGeometryFillPointerDown: no prefix '${geometryIdPrefix}' is known!`,
          );
        }
        const duplicateGeometry = this.getGeometryStore().addOrdered(
          geometryIdPrefix,
          geometryWithoutId as Required<typeof geometryWithoutId>,
          { direct: true },
        );
        draggingIds.push(duplicateGeometry.id);
        this.originalDragState.set(duplicateGeometry.id, DragState.get(duplicateGeometry));
        this.getSelectionManager().deselect(geometry.id).select(duplicateGeometry.id);
      }
    } else {
      draggingIds = selectedIds;
      this.originalDragState = new Map(
        draggingIds.flatMap((id) => {
          const geom = this.getGeometryStore().getById(id);
          if (!geom) {
            return [];
          }

          // Also select any filters which are attached to the given selected geometry id (ie,
          // mirror filters)
          const associatedFilterPairs = this.getGeometryStore()
            .findFiltersByGeometryId(id)
            .map((filter) => {
              return [filter.id, DragState.get(filter)] as const;
            });

          return [[id, DragState.get(geom)], ...associatedFilterPairs];
        }),
      );
    }
    this.draggingMoveIds = Array.from(new Set(draggingIds));
    this.draggingConstrainedTrackResult = this.computeShapeMoveTracks(
      draggingIds,
      this.dragStartSheetPos,
    );

    // NOTE: wait to emit the `dragStateChange` event until the mouse moves, because otherwise then
    // clicks will be seen as drags and clicking on polygons is also used for selecting.
    this.initialDragStateChangeEmitted = false;

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!this.initialDragStateChangeEmitted) {
          this.emit('dragStateChange', { type: 'geometry-translation', ids: draggingIds });
          this.initialDragStateChangeEmitted = true;

          // If the user has dragged, make sure that the geometry is selected
          // It can get de-selected if the user holds shift and clicks (ie, "remove from selection")
          // but then starts dragging
          if (!duplicated) {
            this.getSelectionManager().select(entityId);
            const geom = this.getGeometryStore().getById(entityId);
            if (geom) {
              this.originalDragState.set(entityId, DragState.get(geom));
              draggingIds.push(entityId);

              if (this.dragStartSheetPos) {
                this.draggingMoveIds = Array.from(new Set(draggingIds));
                this.draggingConstrainedTrackResult = this.computeShapeMoveTracks(
                  draggingIds,
                  this.dragStartSheetPos,
                );
              }
            }
          }
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        if (this.draggingConstrainedTrackResult.type === 'immobile') {
          return;
        }
        if (this.draggingConstrainedTrackResult.type === 'rotate') {
          this.applyConstrainedRotation(sheet);
          return;
        }
        const snapped = applySnappingOnConstrainedTrack(
          sheet,
          this.draggingConstrainedTrackResult,
          {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
            selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(entityId),
            viewportScale: liveViewport.scale,
          },
          this.getSheet()?.epsilon ?? 0.001,
        );

        // Compute the origin of the selection for snapping purposes.
        // For a single shape this is the selection-inspector x/y (upperLeft for rect,
        // center for ellipse, bounding box upper-left for polygon). For multi-selection
        // it is the upper-left of the union bounding box.
        const selectionOrigin = computeSelectionOrigin(this.originalDragState);
        if (!selectionOrigin) {
          // There should always be a selected origin in practice if at least one
          // Entity<GeometryComponent> is selected.
          return;
        }

        // Cursor delta in snapped space (same as before)
        const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
        const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);

        // Where the origin would land if it followed the cursor
        const rawNewOrigin = new SheetPosition(selectionOrigin.x + dx, selectionOrigin.y + dy);

        // Snap only the origin to the grid (skip if ctrl held or constraint tracks are active)
        let snappedOrigin = rawNewOrigin;
        if (
          !this.toolManager.getCtrlHeld() &&
          this.draggingConstrainedTrackResult.type === 'unconstrained'
        ) {
          snappedOrigin = applySnapping(rawNewOrigin, {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
            selectedGeometryFilters: this.getGeometryStore().findFiltersByGeometryId(entityId),
            viewportScale: liveViewport.scale,
          });
        }

        // Uniform delta to apply to all points
        const finalDx = snappedOrigin.x - selectionOrigin.x;
        const finalDy = snappedOrigin.y - selectionOrigin.y;

        for (const [id, state] of this.originalDragState) {
          this.getGeometryStore().updateByIdDirect(id, (geometry) => {
            if (!state) {
              return geometry;
            }
            const newState = DragState.translate(state, (oldPoint) => {
              return new SheetPosition(oldPoint.x + finalDx, oldPoint.y + finalDy);
            });
            return DragState.apply(newState, geometry);
          });
        }
      },
      onCommit: (_sp) => {
        const forwardsActions: Array<UndoEntry> = [];
        for (const [id, state] of this.originalDragState) {
          if (!state) {
            continue;
          }
          const entity = this.getGeometryStore().getById(id);
          if (!entity) {
            continue;
          }
          const newState = DragState.get(entity);
          if (!newState) {
            continue;
          }

          // Newly added geometies via alt+drag must be officially logged as created
          if (duplicated) {
            forwardsActions.push(UndoEntry.insert(entity));
          }

          // And also log any position changes
          let beforeRotation: RotationData | null = null;
          switch (state.state) {
            case 'geometry':
              beforeRotation = RotationComponent.getOptional(state.geometry) ?? null;;
              break;
            case 'transformable':
              beforeRotation = RotationComponent.getOptional(state.entity) ?? null;
              break;
          }
          const afterRotation = RotationComponent.getOptional(entity) ?? null;
          const rotationChanged =
            beforeRotation !== null &&
            afterRotation !== null &&
            beforeRotation.angle.toDegrees().magnitude !==
              afterRotation.angle.toDegrees().magnitude;

          if (!DragState.equals(state, newState) || rotationChanged) {
            // FIXME: replace with one single event
            switch (state.state) {
              case 'geometry': {
                const move = this.buildMoveUndoEntry(state.geometry, entity);
                if (move) {
                  forwardsActions.push(move);
                }
                break;
              }
              case 'datum': {
                const move = this.buildMoveUndoEntry(state.entity, entity);
                if (move) {
                  forwardsActions.push(move);
                }
                break;
              }
              case 'filter': {
                const move = this.buildMoveUndoEntry(state.entity, entity);
                if (move) {
                  forwardsActions.push(move);
                }
                break;
              }
              case 'frame': {
                const move = this.buildMoveUndoEntry(state.entity, entity);
                if (move) {
                  forwardsActions.push(move);
                }
                break;
              }
              case 'transformable': {
                const adapter = TransformableTemplate.getForEntity(state.entity);
                if (adapter?.createMoveUndoEntry) {
                  forwardsActions.push(
                    adapter.createMoveUndoEntry(
                      entity.id,
                      adapter.get(state.entity),
                      adapter.get(entity),
                    ) as UndoEntry,
                  );
                }
                break;
              }
              default:
                state satisfies never;
                console.warn(
                  `SelectTool.onCommit: untracked layout state.for "${(state as any).for}"`,
                );
                break;
            }

            // Rotation changes are recorded separately from geometry/data moves so undo and redo
            // restore both the position and the angle.
            if (beforeRotation && afterRotation && rotationChanged) {
              forwardsActions.push(
                UndoEntry.rotationChange(entity.id, beforeRotation, afterRotation),
              );
            }
          }
        }
        if (forwardsActions.length > 0) {
          this.getHistoryManager().push(UndoEntry.transaction('geometry-move', forwardsActions));
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.originalDragState) {
          for (const [id, state] of this.originalDragState) {
            if (!state) {
              continue;
            }
            const geometry = this.getGeometryStore().getById(id);
            if (!geometry) {
              continue;
            }
            this.getGeometryStore().updateByIdDirect(id, (old) => DragState.apply(state, old));
          }
        }

        // If alt was held to drag to duplicate, then delete the newly duplicated objects,
        // and reselect the initial set of seelcted objects.
        if (duplicated) {
          for (const id of this.originalDragState.keys()) {
            this.getSelectionManager().deselect(id);
            this.getGeometryStore().deleteByIdDirect(id);
          }
          for (const id of selectedIds) {
            this.getSelectionManager().select(id);
          }
        }

        this.activeDragListener = null;
        this.clearDragState();
      },
    });

    // Don't cancel the event, let it propegate to handleMouseDown too.
    return false;
  }

  /** Starts rotating a single geometry via the rotation handle above the selection box. */
  onRotationHandlePointerDown(
    viewportControls: ViewportControls,
    geometryId: Id,
    screenPos: ScreenPosition,
  ): void {
    const entity = this.getGeometryStore().getById(geometryId);
    const rotationAdapter = entity ? TransformableTemplate.getForEntity(entity) : null;
    if (
      !entity ||
      (!Entity.hasComponent(entity, GeometryComponent) && !rotationAdapter) ||
      !Entity.hasComponent(entity, RotationComponent)
    ) {
      return;
    }

    const pivot = rotationAdapter
      ? rotationAdapter.getOrigin(entity)
      : GeometryComponent.getOrigin(
          this.getGeometryStore().getByIdWithComponent(geometryId, GeometryComponent)!,
        );
    const sheet = screenPos.toWorld(viewportControls.getState().viewport).toSheet();
    this.activeRotationDrag = {
      geometryId,
      beforeRotation: { ...RotationComponent.get(entity) },
      pivot,
      startPointerAngleRadians: Math.atan2(sheet.y - pivot.y, sheet.x - pivot.x),
    };
    this.showTooltip('rotate-geometry');

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const drag = this.activeRotationDrag;
        if (!drag) {
          return;
        }

        const viewport = viewportControls.getState().viewport;
        const pointer = sp.toWorld(viewport).toSheet();
        const pointerAngle = Math.atan2(pointer.y - drag.pivot.y, pointer.x - drag.pivot.x);
        const deltaDegrees = ((pointerAngle - drag.startPointerAngleRadians) * 180) / Math.PI;
        const rawDegrees = drag.beforeRotation.angle.toDegrees().magnitude + deltaDegrees;
        const nextDegrees = normalizeAngleDegrees(
          this.toolManager.getCtrlHeld()
            ? rawDegrees
            : Math.round(rawDegrees / ANGLE_SNAP_DEGREES) * ANGLE_SNAP_DEGREES,
        );

        this.getGeometryStore().updateByIdWithComponentDirect(
          drag.geometryId,
          RotationComponent,
          (geometry) => RotationComponent.update(geometry, { angle: Angle.degrees(nextDegrees) }),
        );
      },
      onCommit: () => {
        const drag = this.activeRotationDrag;
        this.activeRotationDrag = null;
        this.activeDragListener = null;
        this.cancelTooltip();
        this.clearDragState();

        if (!drag) {
          return;
        }
        const afterEntity = this.getGeometryStore().getById(drag.geometryId);
        if (!afterEntity || !Entity.hasComponent(afterEntity, RotationComponent)) {
          return;
        }
        const afterRotation = RotationComponent.get(afterEntity);
        if (
          afterRotation.angle.toDegrees().magnitude ===
          drag.beforeRotation.angle.toDegrees().magnitude
        ) {
          return;
        }
        this.getHistoryManager().push(
          UndoEntry.rotationChange(drag.geometryId, drag.beforeRotation, afterRotation),
        );
      },
      onCancel: () => {
        const drag = this.activeRotationDrag;
        if (drag) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            drag.geometryId,
            RotationComponent,
            (geometry) => RotationComponent.update(geometry, { angle: drag.beforeRotation.angle }),
          );
        }
        this.activeRotationDrag = null;
        this.activeDragListener = null;
        this.cancelTooltip();
        this.clearDragState();
      },
    });
  }

  /** Starts resizing one or more geometries via a corner or edge handle of the bounding box. */
  onGeometryResizePointerDown(
    viewportControls: ViewportControls,
    geometryIds: Array<Id>,
    resizeMode: ResizeMode,
  ): void {
    // Capture original layout states and full entities for all geometries
    const originalStates = new Map<Id, DragState>();
    const originalEntities = new Map<Id, Entity>();
    for (const id of geometryIds) {
      const geometry = this.getGeometryStore().getById(id);
      if (!geometry) {
        continue;
      }
      originalEntities.set(id, geometry);
      const state = DragState.get(geometry);
      if (state) {
        originalStates.set(id, state);
      }
    }
    if (originalStates.size === 0) {
      return;
    }

    // Compute the shared oriented resize frame (and per-entity frames) for this selection.
    const resizeFrame = computeSelectionResizeFrame(Array.from(originalEntities.values()));
    if (!resizeFrame) {
      return;
    }

    // Determine linkDimensions: single geometry reads its component, multi-select ignores it
    let linkDimensions = false;
    if (geometryIds.length === 1) {
      const geometry = this.getGeometryStore().getById(geometryIds[0]);
      if (geometry && Entity.hasComponent(geometry, LinkDimensionsComponent)) {
        linkDimensions = LinkDimensionsComponent.get(geometry);
      }
    }

    this.resizeMode = resizeMode;
    this.resizeOriginalGroupStates = originalStates;
    this.resizeOriginalEntities = originalEntities;
    this.resizeOriginalFrame = resizeFrame;
    this.draggingGeometryIds = geometryIds;
    this.emit('dragStateChange', {
      type: 'geometry-resize',
      ids: geometryIds,
      mode: resizeMode,
    });

    const pointerOutset = computeResizePointerOutset(
      resizeMode,
      resizeFrame.bbox.angleDegrees,
      SELECTED_OUTSET_PX,
    );
    const initialPointerDownOffsetXPx = pointerOutset.x;
    const initialPointerDownOffsetYPx = pointerOutset.y;

    if (resizeMode.type === 'corner') {
      this.draggingConstrainedTrackResult = this.computeCornerResizeTracks(
        geometryIds,
        resizeMode.corner,
        resizeFrame.bbox,
      );
    } else if (resizeMode.type === 'edge') {
      this.draggingConstrainedTrackResult = this.computeEdgeResizeTracks(
        geometryIds,
        resizeMode.edge,
        resizeFrame.bbox,
      );
    }

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        const groupStates = this.resizeOriginalGroupStates;
        const resizeFrame = this.resizeOriginalFrame;
        if (!this.draggingGeometryIds || !this.resizeMode || !resizeFrame || !groupStates) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnappingOnConstrainedTrack(
          sheet,
          this.draggingConstrainedTrackResult,
          {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
            selectedGeometryFilters:
              geometryIds.length === 1
                ? this.getGeometryStore().findFiltersByGeometryId(geometryIds[0])
                : [],
            viewportScale: liveViewport.scale,
          },
          this.getSheet()?.epsilon ?? 0.001,
        );

        const altHeld = this.toolManager.getAltHeld();
        const shiftHeld = this.toolManager.getShiftHeld();

        const params: ResizeParams = {
          to: snapped,
          mode: this.resizeMode,
          altHeld,
          shiftHeld,
          linkDimensions,
        };

        // Apply the resize in the shared oriented frame. Each geometry uses its own pivot so
        // anchor offsets come out correctly, while the group bbox keeps multi-selection scaling
        // percentage-based (and preserves the legacy unrotated behavior).
        for (const [id, originalState] of groupStates) {
          const stateParams: ResizeParams = {
            ...params,
            frame: resizeFrame.perEntity.get(id) ?? resizeFrame.frame,
          };
          const newState = DragState.resize(originalState, stateParams, resizeFrame.bbox);
          if (newState) {
            this.getGeometryStore().updateByIdDirect(id, (old) => DragState.apply(newState, old));
          }
        }

        // Resizing changes the raw origin (which is the rotation pivot), so a rotated geometry can
        // drift even though the raw opposite corner stayed pinned. Translate the resized result
        // back so the opposite handle/edge stays pinned in rendered space.
        if (
          resizeFrame.strategy !== 'axis-aligned-fallback' &&
          resizeFrame.bbox.angleDegrees !== 0
        ) {
          const beforePinned = getPinnedResizePosition(this.resizeMode, resizeFrame.bbox, altHeld);
          const afterEntities = Array.from(groupStates.keys()).flatMap((id) => {
            const entity = this.getGeometryStore().getById(id);
            return entity ? [entity] : [];
          });
          const afterFrame = computeSelectionResizeFrame(afterEntities);
          if (afterFrame) {
            const afterPinned = getPinnedResizePosition(this.resizeMode, afterFrame.bbox, altHeld);
            const correctionX = afterPinned.x - beforePinned.x;
            const correctionY = afterPinned.y - beforePinned.y;
            if (Math.abs(correctionX) > 1e-9 || Math.abs(correctionY) > 1e-9) {
              for (const [id] of groupStates) {
                this.getGeometryStore().updateByIdDirect(id, (old) => {
                  if (!Entity.hasComponent(old, GeometryComponent)) {
                    return old;
                  }
                  return GeometryComponent.transform(
                    old,
                    (p) => new SheetPosition(p.x - correctionX, p.y - correctionY),
                  );
                });
              }
            }
          }
        }

        // Sync fill color for geometries with mirror filters on every mousemove
        for (const [id] of groupStates) {
          const filters = this.getGeometryStore().findFiltersByGeometryId(id);
          if (filters.length > 0) {
            this.getGeometryStore().updateByIdWithComponentDirect(
              id,
              GeometryComponent,
              (geometry) => FilterComponent.syncFillColor(geometry, filters)[0],
            );
          }
        }
      },
      onCommit: (_sp) => {
        if (this.resizeOriginalGroupStates && this.draggingGeometryIds) {
          this.getHistoryManager().applyTransaction('geometry-resize', () => {
            for (const [id, originalState] of this.resizeOriginalGroupStates!) {
              const afterEntity = this.getGeometryStore().getById(id);
              if (!afterEntity) {
                continue;
              }
              const afterState = DragState.get(afterEntity);
              if (!afterState || DragState.equals(originalState, afterState)) {
                continue;
              }

              // FIXME: replace with one single event
              switch (originalState.state) {
                case 'geometry': {
                  for (const entry of this.buildTransformUndoEntries(
                    originalState.geometry,
                    afterEntity,
                  )) {
                    this.getHistoryManager().push(entry);
                  }
                  break;
                }
                case 'datum':
                  console.warn(
                    'SelectTool.onCommit: Datum was resized, but this should not be possible. Doing nothing.',
                  );
                  break;
                case 'filter':
                  console.warn(
                    'SelectTool.onCommit: Filter was resized, but this should not be possible. Doing nothing.',
                  );
                  break;
                case 'frame': {
                  for (const entry of this.buildTransformUndoEntries(
                    originalState.entity,
                    afterEntity,
                  )) {
                    this.getHistoryManager().push(entry);
                  }
                  break;
                }
                case 'transformable':
                  console.warn(
                    'SelectTool.onCommit: Transformable entity was resized, but this should not be possible. Doing nothing.',
                  );
                  break;
                default:
                  originalState satisfies never;
                  console.warn(
                    `SelectTool.onCommit: untracked layout originalState.state "${(originalState as any).state}"`,
                  );
                  break;
              }
            }

            // After resizing, sync fill color for geometries with mirror filters
            for (const [id, originalState] of this.resizeOriginalGroupStates!) {
              if (originalState.state !== 'geometry') {
                continue;
              }
              const filters = this.getGeometryStore().findFiltersByGeometryId(id);
              if (filters.length === 0) {
                continue;
              }
              // Use the original entity (with FillColorComponent) for correct history
              const originalEntity = this.resizeOriginalEntities?.get(id);
              this.getGeometryStore().updateByIdWithComponentDirect(
                id,
                GeometryComponent,
                (geometry) => {
                  const [output, historyEvents] = FilterComponent.syncFillColor(
                    geometry,
                    filters,
                    originalEntity as
                      | Entity<GeometryComponent & Partial<FillColorComponent>>
                      | undefined,
                  );
                  if (output !== geometry) {
                    for (const event of historyEvents) {
                      this.getHistoryManager().push(event);
                    }
                  }
                  return output;
                },
              );
            }
          });
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.resizeOriginalGroupStates) {
          for (const [id, originalState] of this.resizeOriginalGroupStates) {
            this.getGeometryStore().updateByIdDirect(id, (old) =>
              DragState.apply(originalState, old),
            );
          }

          // Restore fill color from original entities (which include FillColorComponent)
          if (this.resizeOriginalEntities) {
            for (const [id, originalEntity] of this.resizeOriginalEntities) {
              this.getGeometryStore().updateByIdDirect(id, (old) => {
                if (Entity.hasComponent(originalEntity, FillColorComponent)) {
                  const fillColor = FillColorComponent.get(originalEntity);
                  return FillColorComponent.update(old, fillColor);
                } else {
                  return FillColorComponent.remove(old);
                }
              });
            }
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /**
   * Computes constrained tracks for a corner resize.
   *
   * Handles constraints attached to rectangle corners (direct 1:1 mapping), ellipse key points
   * (left / top / right / bottom / center), and polygon vertices.  For non-rectangle shapes the
   * constraint track is offset by the delta between the constrained endpoint and the dragged
   * corner so the snap is applied at the cursor rather than at the endpoint.
   */
  private computeCornerResizeTracks(
    geometryIds: Array<Id>,
    corner: ResizeCorner,
    frame: OrientedRect<SheetPosition>,
  ): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return ConstrainedTrackPath.Unconstrained;
    }

    const matchedGeometryIdConstraintsPairs = geometryIds.flatMap((id) =>
      this.getGeometryStore()
        .findConstraintsByGeometryId(id)
        .map((c) => [id, c] as const),
    );
    if (matchedGeometryIdConstraintsPairs.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    const cornerPos = getOrientedCornerPosition(corner, frame);

    const tracks: Array<ConstrainedTrack> = [];

    for (const [geometryId, c] of matchedGeometryIdConstraintsPairs) {
      const built = this.buildSingleConstrainedTrack(c, geometryId, sheetConfig.defaultUnit);
      if (!built) {
        continue;
      }

      // Only handle locked endpoints (attached to the resizing geometry).  Free 'point'
      // endpoints are fixed on the sheet and cannot participate.
      if (
        built.shapeEndpoint.type !== 'locked-rectangle' &&
        built.shapeEndpoint.type !== 'locked-ellipse' &&
        built.shapeEndpoint.type !== 'locked-polygon'
      ) {
        continue;
      }

      // Offset the track so it constrains the dragged corner rather than the constrained
      // endpoint.  During resize all points are proportionally mapped within the bounding
      // box, so the offset is a reasonable approximation of the spatial relationship.
      const offset = new SheetPosition(
        built.endpointPos.x - cornerPos.x,
        built.endpointPos.y - cornerPos.y,
      );

      tracks.push(ConstrainedTrack.applyOffset(built.track, offset));
    }

    if (tracks.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    // Reduce all tracks together
    let result: Array<ConstrainedTrack> = [tracks[0]];
    for (let i = 1; i < tracks.length; i += 1) {
      const next: Array<ConstrainedTrack> = [];
      for (const existing of result) {
        const intersection = ConstrainedTrack.intersectTracks(
          existing,
          tracks[i],
          sheetConfig.epsilon,
        );
        if (intersection === 'immobile') {
          continue;
        }
        next.push(...intersection);
      }
      if (next.length === 0) {
        return ConstrainedTrackPath.Immobile;
      }
      result = next;
    }
    return ConstrainedTrackPath.translate(result);
  }

  /**
   * Computes constrained tracks for an edge resize.
   *
   * For rectangles and ellipses, restricts constraint tracks to the edge's movement axis
   * (1D) since endpoints on the dragged edge move in only one coordinate.  For polygons,
   * uses the same 2D offset approach as corner resize since vertices scale proportionally.
   */
  private computeEdgeResizeTracks(
    geometryIds: Array<Id>,
    edge: ResizeEdge,
    frame: OrientedRect<SheetPosition>,
  ): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return ConstrainedTrackPath.Unconstrained;
    }

    const matchedGeometryIdConstraintsPairs = geometryIds.flatMap((id) =>
      this.getGeometryStore()
        .findConstraintsByGeometryId(id)
        .map((c) => [id, c] as const),
    );
    if (matchedGeometryIdConstraintsPairs.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    const pivot = frame.position;
    const toLocal = (position: SheetPosition) =>
      rotatePointAround(position, pivot, -frame.angleDegrees);
    const toRendered = (position: SheetPosition) =>
      rotatePointAround(position, pivot, frame.angleDegrees);

    const tracks: Array<ConstrainedTrack> = [];

    for (const [geometryId, c] of matchedGeometryIdConstraintsPairs) {
      const built = this.buildSingleConstrainedTrack(c, geometryId, sheetConfig.defaultUnit);
      if (!built) {
        continue;
      }

      if (
        built.shapeEndpoint.type !== 'locked-rectangle' &&
        built.shapeEndpoint.type !== 'locked-ellipse' &&
        built.shapeEndpoint.type !== 'locked-polygon'
      ) {
        continue;
      }

      const localEndpointPos = toLocal(built.endpointPos);
      if (!isEndpointOnEdge(built.shapeEndpoint, edge, localEndpointPos, frame)) {
        continue;
      }

      const axis = edge === 'top' || edge === 'bottom' ? 'y' : 'x';
      const fixedCoord = axis === 'y' ? localEndpointPos.x : localEndpointPos.y;
      const localTrack = transformConstrainedTrack(built.track, toLocal, -frame.angleDegrees);
      const restricted = ConstrainedTrack.restrictToAxis(
        localTrack,
        fixedCoord,
        axis,
        sheetConfig.epsilon,
      );
      if (restricted === 'immobile') {
        return ConstrainedTrackPath.Immobile;
      }
      if (restricted !== null) {
        tracks.push(transformConstrainedTrack(restricted, toRendered, frame.angleDegrees));
      }
    }

    if (tracks.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    // Reduce all tracks together
    let result: Array<ConstrainedTrack> = [tracks[0]];
    for (let i = 1; i < tracks.length; i += 1) {
      const next: Array<ConstrainedTrack> = [];
      for (const existing of result) {
        const intersection = ConstrainedTrack.intersectTracks(
          existing,
          tracks[i],
          sheetConfig.epsilon,
        );
        if (intersection === 'immobile') {
          continue;
        }
        next.push(...intersection);
      }
      if (next.length === 0) {
        return ConstrainedTrackPath.Immobile;
      }
      result = next;
    }
    return ConstrainedTrackPath.translate(result);
  }

  /** Returns the absolute rotation in degrees for a drag state, or null when it has no rotation. */
  private getDragStateRotationDegrees(state: DragState | null | undefined): number | null {
    if (!state) {
      return null;
    }
    if (state.state === 'geometry') {
      return RotationComponent.getOptional(state.geometry)?.angle.toDegrees().magnitude ?? null;
    }
    if (state.state === 'transformable') {
      return RotationComponent.getOptional(state.entity)?.angle.toDegrees().magnitude ?? null;
    }
    return null;
  }

  /**
   * True when every selected entity and every implicitly dragged filter can rotate rigidly.
   * Datums are supported because rotating one only changes its position.
   */
  private canRotateSelectionGroup(): boolean {
    for (const id of this.draggingMoveIds) {
      const entity = this.getGeometryStore().getById(id);
      if (!entity) {
        continue;
      }
      if (Entity.hasComponent(entity, GeometryComponent)) {
        if (!Entity.hasComponent(entity, RotationComponent)) {
          return false;
        }
      } else if (TransformableTemplate.getForEntity(entity)) {
        if (!Entity.hasComponent(entity, RotationComponent)) {
          return false;
        }
      } else if (Entity.hasComponent(entity, DatumComponent)) {
        continue;
      } else {
        return false;
      }
    }

    for (const [, state] of this.originalDragState) {
      if (!state) {
        continue;
      }
      switch (state.state) {
        case 'geometry':
          if (!Entity.hasComponent(state.geometry, RotationComponent)) {
            return false;
          }
          break;
        case 'transformable':
          if (!Entity.hasComponent(state.entity, RotationComponent)) {
            return false;
          }
          break;
        case 'filter': {
          const filter = FilterComponent.get(state.entity);
          if (filter.type === 'pattern' && filter.mode === 'grid') {
            return false;
          }
          break;
        }
        case 'datum':
          break;
        case 'frame':
          return false;
        default:
          state satisfies never;
          return false;
      }
    }

    return true;
  }

  /** Builds a drag state rotated rigidly around the given world pivot by `deltaDegrees`. */
  private buildRotatedDragState(
    state: DragState,
    pivot: SheetPosition,
    deltaDegrees: number,
  ): DragState | null {
    switch (state.state) {
      case 'geometry': {
        const rotation = RotationComponent.getOptional(state.geometry);
        if (!rotation) {
          return null;
        }
        const origin = GeometryComponent.getOrigin(state.geometry);
        const rawPivot = applyToPoint(inverse(Entity.generateRenderMatrix(state.geometry)), pivot);
        const rotated = rotateAnchorAroundPivot(
          origin,
          rotation.angle.toDegrees().magnitude,
          new SheetPosition(rawPivot.x, rawPivot.y),
          deltaDegrees,
        );
        const next = DragState.translate(
          state,
          (point) =>
            new SheetPosition(
              point.x + rotated.position.x - origin.x,
              point.y + rotated.position.y - origin.y,
            ),
        );
        if (next.state !== 'geometry') {
          return null;
        }
        return {
          ...next,
          geometry: RotationComponent.update(next.geometry as Entity<RotationComponent>, {
            angle: Angle.degrees(normalizeAngleDegrees(rotated.rotationDegrees)),
          }) as typeof next.geometry,
        };
      }
      case 'transformable': {
        const rotation = RotationComponent.getOptional(state.entity);
        if (!rotation) {
          return null;
        }
        const adapter = TransformableTemplate.getForEntity(state.entity);
        if (!adapter) {
          return null;
        }
        const origin = adapter.getOrigin(state.entity);
        const rawPivot = applyToPoint(inverse(Entity.generateRenderMatrix(state.entity)), pivot);
        const rotated = rotateAnchorAroundPivot(
          origin,
          rotation.angle.toDegrees().magnitude,
          new SheetPosition(rawPivot.x, rawPivot.y),
          deltaDegrees,
        );
        const next = DragState.translate(
          state,
          (point) =>
            new SheetPosition(
              point.x + rotated.position.x - origin.x,
              point.y + rotated.position.y - origin.y,
            ),
        );
        if (next.state !== 'transformable') {
          return null;
        }
        return {
          ...next,
          entity: RotationComponent.update(next.entity as Entity<RotationComponent>, {
            angle: Angle.degrees(normalizeAngleDegrees(rotated.rotationDegrees)),
          }),
        };
      }
      case 'filter': {
        const filter = FilterComponent.get(state.entity);
        switch (filter.type) {
          case 'fillet':
          case 'chamfer':
            return state;
          case 'mirror':
          case 'pattern':
            if (filter.type === 'pattern' && filter.mode === 'grid') {
              return null;
            }
            return {
              state: 'filter',
              entity: FilterComponent.translate(state.entity, (point) =>
                rotatePointAround(point, pivot, deltaDegrees),
              ),
            };
          default:
            filter satisfies never;
            return null;
        }
      }
      case 'datum': {
        const position = DatumComponent.get(state.entity);
        return DragState.translate(state, () => rotatePointAround(position, pivot, deltaDegrees));
      }
      case 'frame':
        return null;
      default:
        state satisfies never;
        return null;
    }
  }

  /** Applies a `rotate` constrained track path to the dragged entity (or group). */
  private applyConstrainedRotation(pointer: SheetPosition): void {
    const constrainedTrackPath = this.draggingConstrainedTrackResult;
    if (constrainedTrackPath.type !== 'rotate') {
      return;
    }

    const dragStart = this.dragStartSheetPos;
    if (!dragStart) {
      return;
    }

    if (this.draggingMoveIds.length > 1) {
      const referenceId = constrainedTrackPath.referenceEntityId;
      const referenceState = referenceId ? this.originalDragState.get(referenceId) : undefined;
      const referenceRotation = this.getDragStateRotationDegrees(referenceState);
      if (referenceRotation === null) {
        return;
      }

      const delta = computeConstrainedRotationDelta(
        pointer,
        dragStart,
        constrainedTrackPath,
        referenceRotation,
        {
          ctrlHeld: this.toolManager.getCtrlHeld(),
          epsilon: this.getSheet()?.epsilon ?? 0.001,
        },
      );
      if (delta.type === 'immobile' || !this.canRotateSelectionGroup()) {
        return;
      }

      const updates: Array<[Id, DragState]> = [];
      for (const [id, state] of this.originalDragState) {
        if (!state) {
          continue;
        }
        const next = this.buildRotatedDragState(state, delta.center, delta.deltaDegrees);
        if (!next) {
          return;
        }
        updates.push([id, next]);
      }

      for (const [id, next] of updates) {
        this.getGeometryStore().updateByIdDirect(id, (old) => DragState.apply(next, old));
      }
      return;
    }

    for (const [id, state] of this.originalDragState) {
      if (!state) {
        continue;
      }

      let originalEntity: Entity;
      let origin: SheetPosition | null;
      if (state.state === 'geometry') {
        if (!Entity.hasComponent(state.geometry, RotationComponent)) {
          continue;
        }
        originalEntity = state.geometry;
        origin = GeometryComponent.getOrigin(state.geometry);
      } else if (state.state === 'transformable') {
        if (!Entity.hasComponent(state.entity, RotationComponent)) {
          continue;
        }
        const adapter = TransformableTemplate.getForEntity(state.entity);
        if (!adapter) {
          continue;
        }
        originalEntity = state.entity;
        origin = adapter.getOrigin(state.entity);
      } else {
        continue;
      }

      if (!origin) {
        continue;
      }

      const originalRotation = RotationComponent.get(
        originalEntity as Entity<RotationComponent>,
      ).angle.toDegrees().magnitude;
      const inverseRenderMatrix = inverse(Entity.generateRenderMatrix(originalEntity));
      const result = applyRotationOnConstrainedTrack(
        pointer,
        dragStart,
        constrainedTrackPath,
        origin,
        originalRotation,
        {
          ctrlHeld: this.toolManager.getCtrlHeld(),
          epsilon: this.getSheet()?.epsilon ?? 0.001,
          pivotInEntitySpace: (center) => {
            const raw = applyToPoint(inverseRenderMatrix, center);
            return new SheetPosition(raw.x, raw.y);
          },
        },
      );
      if (result.type === 'immobile') {
        return;
      }

      const deltaX = result.position.x - origin.x;
      const deltaY = result.position.y - origin.y;
      let nextState = DragState.translate(
        state,
        (point) => new SheetPosition(point.x + deltaX, point.y + deltaY),
      );
      const angle = Angle.degrees(normalizeAngleDegrees(result.rotationDegrees));
      if (nextState.state === 'geometry') {
        nextState = {
          ...nextState,
          geometry: RotationComponent.update(nextState.geometry as Entity<RotationComponent>, {
            angle,
          }) as typeof nextState.geometry,
        };
      } else if (nextState.state === 'transformable') {
        nextState = {
          ...nextState,
          entity: RotationComponent.update(nextState.entity as Entity<RotationComponent>, {
            angle,
          }),
        };
      }

      this.getGeometryStore().updateByIdDirect(id, (old) => DragState.apply(nextState, old));
      return;
    }
  }

  /**
   * Chooses a selected entity whose rotation can be used for angle snapping. Datums (and other
   * entities without a RotationComponent) are never valid references.
   */
  private getRotationReferenceEntityId(
    preferredId: Id | undefined,
    candidateIds: Array<Id>,
  ): Id | undefined {
    const canReference = (id: Id): boolean => {
      const entity = this.getGeometryStore().getById(id);
      return (
        !!entity &&
        !Entity.hasComponent(entity, DatumComponent) &&
        Entity.hasComponent(entity, RotationComponent)
      );
    };

    if (preferredId && canReference(preferredId)) {
      return preferredId;
    }
    return candidateIds.find(canReference);
  }

  /**
   * Computes anchor-relative constrained tracks for a shape whose fill is being dragged.
   * Finds all constraints referencing `geometryId` where exactly one endpoint is on the shape,
   * computes the track for the fixed endpoint, then offsets it so the track applies to the
   * shape's movement anchor rather than the specific key point.
   */
  private computeShapeMoveTracks(
    geometryIds: Array<Id>,
    anchorPosition: SheetPosition,
  ): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return ConstrainedTrackPath.Unconstrained;
    }

    // The drag flow can append the clicked geometry more than once; de-duplicate so the
    // single-entity coincident rotation special case is still detected.
    geometryIds = Array.from(new Set(geometryIds));

    const matchedGeometryIdConstraintsPairs = geometryIds.flatMap((id) =>
      this.getGeometryStore()
        .findConstraintsByGeometryId(id)
        .map((c) => [id, c] as const),
    );
    if (matchedGeometryIdConstraintsPairs.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    // A coincident constraint pins a single point. When it is the only constraint on the dragged
    // entity, the entity is free to rotate around the other point. If the entity has any other
    // constraint, fall through to the normal point-track + intersection pipeline instead.
    if (geometryIds.length === 1) {
      const geometryId = geometryIds[0];
      const activeConstraints = matchedGeometryIdConstraintsPairs
        .filter(([id]) => id === geometryId)
        .map(([, c]) => c);
      const coincidentConstraints = activeConstraints.filter(
        (c) => ConstraintComponent.get(c).type === 'coincident',
      );

      if (coincidentConstraints.length > 1) {
        return ConstrainedTrackPath.Immobile;
      }

      if (activeConstraints.length === 1 && coincidentConstraints.length === 1) {
        const constraint = ConstraintComponent.get(
          coincidentConstraints[0],
        ) as CoincidentConstraintData;
        const attached = (ep: ConstraintEndpoint): boolean =>
          ep.type !== 'point' && ep.id === geometryId;
        const aAttached = attached(constraint.pointA);
        const bAttached = attached(constraint.pointB);

        if (aAttached !== bAttached) {
          const otherEndpoint = aAttached ? constraint.pointB : constraint.pointA;
          const otherPosition = this.getGeometryStore().resolveConstraintEndpoint(otherEndpoint);
          if (otherPosition) {
            return ConstrainedTrackPath.rotate(
              [otherPosition],
              this.getRotationReferenceEntityId(geometryId, [geometryId]),
            );
          }
        }
      }
    }

    // Multi-selection: a group can rotate rigidly around a coincident pivot only when the sole
    // constraint crossing the selection boundary is that coincident constraint. Constraints
    // entirely inside the selection are preserved by the rigid rotation and don't block it.
    if (geometryIds.length > 1) {
      const selectedIds = new Set(geometryIds);
      const uniqueConstraints = new Map<string, Entity<ConstraintComponent>>();
      for (const [, constraint] of matchedGeometryIdConstraintsPairs) {
        uniqueConstraints.set(constraint.id, constraint);
      }

      const isInside = (endpoint: ConstraintEndpoint): boolean =>
        endpoint.type !== 'point' && selectedIds.has(endpoint.id);

      const crossingConstraints: Array<Entity<ConstraintComponent>> = [];
      for (const constraintGeom of uniqueConstraints.values()) {
        let hasInside = false;
        let hasOutside = false;
        for (const key of Constraint.getPositionKeys(constraintGeom)) {
          const endpoint = Constraint.getEndpoint(constraintGeom, key);
          if (!endpoint) {
            continue;
          }
          if (isInside(endpoint)) {
            hasInside = true;
          } else {
            hasOutside = true;
          }
        }
        if (hasInside && hasOutside) {
          crossingConstraints.push(constraintGeom);
        }
      }

      if (crossingConstraints.length === 1) {
        const constraint = ConstraintComponent.get(crossingConstraints[0]) as ConstraintData;
        if (constraint.type === 'coincident') {
          const aInside = isInside(constraint.pointA);
          const bInside = isInside(constraint.pointB);
          if (aInside !== bInside) {
            const outsideEndpoint = aInside ? constraint.pointB : constraint.pointA;
            const insideEndpoint = aInside ? constraint.pointA : constraint.pointB;
            const pivot = this.getGeometryStore().resolveConstraintEndpoint(outsideEndpoint);
            if (pivot && insideEndpoint.type !== 'point') {
              return ConstrainedTrackPath.rotate(
                [pivot],
                this.getRotationReferenceEntityId(insideEndpoint.id, geometryIds),
              );
            }
          }
        }
      }
    }

    const tracks: Array<ConstrainedTrack> = [];

    for (const [geometryId, c] of matchedGeometryIdConstraintsPairs) {
      const built = this.buildSingleConstrainedTrack(
        c,
        geometryId,
        sheetConfig.defaultUnit,
        geometryIds.filter((id) => id !== geometryId),
      );
      if (!built) {
        continue;
      }

      const offset = new SheetPosition(
        built.endpointPos.x - anchorPosition.x,
        built.endpointPos.y - anchorPosition.y,
      );
      tracks.push(ConstrainedTrack.applyOffset(built.track, offset));
    }

    if (tracks.length === 0) {
      return ConstrainedTrackPath.Unconstrained;
    }

    // Reduce all tracks together
    let result: Array<ConstrainedTrack> = [tracks[0]];
    for (let i = 1; i < tracks.length; i += 1) {
      const next: Array<ConstrainedTrack> = [];
      for (const existing of result) {
        const intersection = ConstrainedTrack.intersectTracks(
          existing,
          tracks[i],
          sheetConfig.epsilon,
        );
        if (intersection === 'immobile') {
          continue;
        }
        next.push(...intersection);
      }
      if (next.length === 0) {
        return ConstrainedTrackPath.Immobile;
      }
      result = next;
    }
    return ConstrainedTrackPath.translate(result);
  }

  onEnterPolygonSegment(
    _viewportControls: ViewportControls,
    _polygonId: Id,
    _segmentIndex: number,
  ) {
    this.emit('hoveringPolygonSegmentChange', true);
    this.scheduleTooltip('add-point', ADD_POINT_TOOLTIP_TIMEOUT_MS);
  }

  onLeavePolygonSegment(
    _viewportControls: ViewportControls,
    _polygonId: Id,
    _segmentIndex: number,
  ) {
    this.emit('hoveringPolygonSegmentChange', false);
    this.cancelTooltip();
  }

  /** Deletes all currently selected geometry (polygons, rectangles, ellipses), recording to history. */
  private deleteSelectedGeometry(): void {
    this.getHistoryManager().applyTransaction(
      'delete-selected',
      () => {
        for (const id of this.getSelectionManager().getSelectedIds()) {
          this.getGeometryStore().deleteById(id);
        }
      },
      { collapseIfSingle: true },
    );
    this.getSelectionManager().clearSelection();
  }

  /** Adds a point on the specified line segment edge of a polygon at the given click position. */
  addPointOnLineSegmentEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    // The renderer reports the closest point in rendered space; store geometry is raw.
    const geom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    const rawPoint = geom
      ? renderedPointToRaw(
          geom as Entity<GeometryComponent & Partial<AnchorPointComponent>>,
          sheetPos,
        )
      : sheetPos;
    this.getGeometryStore().addPointOnLineSegmentEdge(polygonId, segmentIndex, rawPoint);
  }

  /** Adds a point on the specified quadratic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnQuadraticEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const geom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    if (!geom || !GeometryComponent.isPolygon(geom)) {
      return;
    }

    const quadPoints = PolygonData.renderedSegments(geom);
    const pointSegment = quadPoints[segmentIndex];
    const arcSegment = quadPoints[segmentIndex + 1];
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

    const result = closestPointOnQuadraticCurve(curve, sheetPos);

    this.getGeometryStore().addPointOnQuadraticEdge(polygonId, segmentIndex, result.t);
  }

  /** Adds a point on the specified cubic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnCubicEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const geom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    if (!geom || !GeometryComponent.isPolygon(geom)) {
      return;
    }

    const cubicPoints = PolygonData.renderedSegments(geom);
    const pointSegment = cubicPoints[segmentIndex];
    const arcSegment = cubicPoints[segmentIndex + 1];
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

    const result = closestPointOnCubicCurve(curve, sheetPos);
    this.getGeometryStore().addPointOnCubicEdge(polygonId, segmentIndex, result.t);
  }

  // ==================== DATUM HANDLERS ====================

  handleDatumRingPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    geometryId: Id,
  ): boolean {
    return this.handleFillPointerDown(screenPos, viewportControls, geometryId);
  }

  // ==================== CONSTRAINT HANDLERS ====================

  onConstraintEndpointPointerDown<CD extends ConstraintData>(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    constraintId: Constraint['id'],
    pointKey: keyof CD,
  ): void {
    const constraintGeom = this.getGeometryStore().getByIdWithComponent(
      constraintId,
      ConstraintComponent,
    );
    if (!constraintGeom) {
      return;
    }
    const constraint = ConstraintComponent.get<CD>(constraintGeom);

    const sheetPos = screenPos.toWorld(viewportControls.getState().viewport).toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: false,
      viewportScale: viewportControls.getState().viewport.scale,
    });

    const originalEndpoint = constraint[pointKey] as ConstraintEndpoint;
    const resolvedPos =
      this.getGeometryStore().resolveConstraintEndpoint(originalEndpoint) ?? snapped;
    const originalPointA = constraint.pointA;
    const originalPointB = constraint.pointB;

    // If the endpoint was locked to geometry, detach it by converting to a free-floating point.
    // This lets the user freely reposition it via drag.
    if (originalEndpoint.type !== 'point') {
      this.getGeometryStore().updateByIdWithComponentDirect(
        constraintId,
        ConstraintComponent,
        (g) => ConstraintComponent.update(g, { [pointKey]: ConstraintEndpoint.point(resolvedPos) }),
      );
    }

    const dragStartRawSheetPos = sheetPos;

    this.emit('snapHintsVisibilityChange', { keyPoints: true });

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();

        const rawDx = sheet.x - (dragStartRawSheetPos?.x ?? 0);
        const rawDy = sheet.y - (dragStartRawSheetPos?.y ?? 0);
        const freePos = new SheetPosition(resolvedPos.x + rawDx, resolvedPos.y + rawDy);

        const { endpoint: rawEndpoint } = applyKeyPointSnapping(
          freePos,
          this.toolManager.getCtrlHeld(),
          {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            superHeld: false,
            viewportScale: liveViewport.scale,
            manager: this,
            geometries: this.getGeometryStore().listWithComponent(GeometryComponent),
            constraints: this.getGeometryStore()
              .listWithComponent(ConstraintComponent)
              .filter((g) => g.id !== constraintId),
            datums: this.getGeometryStore().listWithComponent(DatumComponent),
            constraintEndpointTargets:
              this.getGeometryStore().listWithComponent<TransformableComponent>(
                TransformableComponent,
              ),
            selectedGeometryFilters: [],
          },
        );

        this.getGeometryStore().updateByIdWithComponentDirect(
          constraintId,
          ConstraintComponent,
          (g) => ConstraintComponent.update(g, { [pointKey]: rawEndpoint }),
        );
      },
      onCommit: (_sp) => {
        // Wrap datum creation, constraint updates, and endpoint moves in a
        // single transaction so a single undo reverses everything atomically.
        this.getHistoryManager().applyTransaction('constraint-endpoint-move', () => {
          let afterConstraintGeom = this.getGeometryStore().getByIdWithComponent(
            constraintId,
            ConstraintComponent,
          );
          if (!afterConstraintGeom) {
            return;
          }
          let afterConstraint = ConstraintComponent.get<CD>(afterConstraintGeom);
          const finalEndpoint = afterConstraint[pointKey] as ConstraintEndpoint;
          if (finalEndpoint.type === 'point') {
            const liveViewport = viewportControls.getState().viewport;
            const { endpoint: rawEp, shouldCreateDatum: scd } = applyKeyPointSnapping(
              finalEndpoint.point,
              this.toolManager.getCtrlHeld(),
              {
                primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
                secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
                superHeld: false,
                manager: this,
                viewportScale: liveViewport.scale,
                geometries: this.getGeometryStore().listWithComponent(GeometryComponent),
                constraints: this.getGeometryStore()
                  .listWithComponent(ConstraintComponent)
                  .filter((g) => g.id !== constraintId),
                datums: this.getGeometryStore().listWithComponent(DatumComponent),
                constraintEndpointTargets:
                  this.getGeometryStore().listWithComponent<TransformableComponent>(
                    TransformableComponent,
                  ),
                selectedGeometryFilters: [],
              },
            );
            let snappedEndpoint = rawEp;
            if (scd) {
              const { constraintId: cid, key, position } = scd;
              const datum = this.getGeometryStore().add(ID_PREFIXES.datum, Datum.create(position));
              this.getGeometryStore().updateByIdWithComponent(cid, ConstraintComponent, (g) =>
                ConstraintComponent.update(g, {
                  [key]: ConstraintEndpoint.lockedToDatum(datum.id),
                }),
              );
              snappedEndpoint = ConstraintEndpoint.lockedToDatum(datum.id);
            }
            if (snappedEndpoint.type !== 'point') {
              this.getGeometryStore().updateByIdWithComponentDirect(
                constraintId,
                ConstraintComponent,
                (g) => ConstraintComponent.update(g, { [pointKey]: snappedEndpoint }),
              );
              afterConstraintGeom = this.getGeometryStore().getByIdWithComponent(
                constraintId,
                ConstraintComponent,
              );
              afterConstraint = ConstraintComponent.get<CD>(afterConstraintGeom!);
            }
          }

          const changed = !ConstraintEndpoint.equal(
            originalEndpoint,
            afterConstraint[pointKey] as ConstraintEndpoint,
          );
          if (changed) {
            if (constraint.type === 'coincident') {
              this.getHistoryManager().push(
                UndoEntry.coincidentConstraintMoveEndpoints(
                  constraintId,
                  originalPointA,
                  originalPointB,
                  afterConstraint.pointA,
                  afterConstraint.pointB,
                ),
              );
            } else {
              this.getHistoryManager().push(
                UndoEntry.linearConstraintMoveEndpoints(
                  constraintId,
                  originalPointA,
                  originalPointB,
                  afterConstraint.pointA,
                  afterConstraint.pointB,
                ),
              );
            }
          }
        });
        this.emit('keyPointSnapChange', null);
        this.emit('snapHintsVisibilityChange', null);
        this.activeDragListener = null;
      },
      onCancel: () => {
        this.emit('keyPointSnapChange', null);
        this.emit('snapHintsVisibilityChange', null);
        const constraintGeom = this.getGeometryStore().getByIdWithComponent(
          constraintId,
          ConstraintComponent,
        );
        if (constraintGeom) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            constraintId,
            ConstraintComponent,
            (g) =>
              ConstraintComponent.update(g, {
                [pointKey]: originalEndpoint,
                pointA: originalPointA,
                pointB: originalPointB,
              }),
          );
        }
        this.activeDragListener = null;
      },
    });
  }

  /** Called when a mirror filter endpoint handle is clicked and dragged.
   *
   * Uses {@link applySnappingLineSeries} for grid + angular snapping relative to the other
   * endpoint during drag. For radial pattern filters, uses {@link applySnappingOnConstrainedTrack}
   * for grid snap only (no reference endpoint). */
  handleFilterEndpointPointerDown<FD extends FilterData>(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    filterId: Filter['id'],
    pointKey: keyof FD,
  ): void {
    const filter = this.getGeometryStore().getByIdWithComponent(filterId, FilterComponent);
    if (!filter) {
      return;
    }
    const filterData = FilterComponent.get<FD>(filter);
    const rawFilter = filterData as unknown as Record<string, unknown>;

    const sheetPos = screenPos.toWorld(viewportControls.getState().viewport).toSheet();

    switch (filterData.type) {
      case 'chamfer':
      case 'fillet':
        break;
      case 'pattern': {
        const mode = (rawFilter as Record<string, unknown>).mode;
        if (mode !== 'radial') {
          return;
        }
        const radialData = filterData as unknown as { center: SheetPosition };
        const originalCenter = new SheetPosition(radialData.center.x, radialData.center.y);

        this.activeDragListener = createDragListener({
          viewportControls,
          onMove: (sp) => {
            const liveViewport = viewportControls.getState().viewport;
            const world = sp.toWorld(liveViewport);
            const sheet = world.toSheet();
            const snapped = applySnapping(sheet, {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              ctrlHeld: this.toolManager.getCtrlHeld(),
              superHeld: false,
              viewportScale: viewportControls.getState().viewport.scale,
            });
            this.getGeometryStore().updateByIdWithComponentDirect(filterId, FilterComponent, (g) =>
              FilterComponent.update(g, { center: snapped }),
            );
          },
          onCommit: (_sp) => {
            this.getHistoryManager().applyTransaction('radial-filter-center-move', () => {
              const afterFilterGeom = this.getGeometryStore().getByIdWithComponent(
                filterId,
                FilterComponent,
              );
              if (!afterFilterGeom) {
                return;
              }
              const afterFilter = FilterComponent.get(afterFilterGeom);
              const afterRaw = afterFilter as unknown as { center: SheetPosition };

              const changed =
                originalCenter.x !== afterRaw.center.x || originalCenter.y !== afterRaw.center.y;

              if (changed) {
                this.getHistoryManager().push(
                  UndoEntry.patternRadialFilterMoveCenter(
                    filterId,
                    originalCenter,
                    afterRaw.center,
                  ),
                );
              }

              // After moving a filter endpoint, resync the filled state of any associated geometries
              this.getGeometryStore().updateByIdWithComponentDirect(
                filterData.geometryId,
                GeometryComponent,
                (geometry) => {
                  const [output, historyEvents] = FilterComponent.syncFillColor(
                    geometry,
                    this.getGeometryStore().findFiltersByGeometryId(geometry.id),
                  );
                  if (output !== geometry) {
                    for (const event of historyEvents) {
                      this.getHistoryManager().push(event);
                    }
                  }
                  return output;
                },
              );
            });
            this.activeDragListener = null;
          },
          onCancel: () => {
            this.getGeometryStore().updateByIdWithComponentDirect(filterId, FilterComponent, (g) =>
              FilterComponent.update(g, { center: originalCenter }),
            );
            this.activeDragListener = null;
          },
        });
        return;
      }
      case 'mirror': {
        const otherPointKey = pointKey === 'pointA' ? 'pointB' : 'pointA';
        const otherPoint = rawFilter[otherPointKey] as SheetPosition;

        const snapped = applySnappingLineSeries(sheetPos, otherPoint, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          ctrlHeld: this.toolManager.getCtrlHeld(),
          superHeld: this.toolManager.getSuperHeld(),
          viewportScale: viewportControls.getState().viewport.scale,
        });

        const resolvedPos = snapped;
        const originalPointA = rawFilter.pointA as SheetPosition;
        const originalPointB = rawFilter.pointB as SheetPosition;

        const dragStartRawSheetPos = sheetPos;

        this.activeDragListener = createDragListener({
          viewportControls,
          onMove: (sp) => {
            const liveViewport = viewportControls.getState().viewport;
            const world = sp.toWorld(liveViewport);
            const sheet = world.toSheet();

            const rawDx = sheet.x - (dragStartRawSheetPos?.x ?? 0);
            const rawDy = sheet.y - (dragStartRawSheetPos?.y ?? 0);
            const freePos = new SheetPosition(resolvedPos.x + rawDx, resolvedPos.y + rawDy);

            const currentFilterGeom = this.getGeometryStore().getByIdWithComponent(
              filterId,
              FilterComponent,
            );
            if (!currentFilterGeom) {
              return;
            }
            const currentFilter = FilterComponent.get(currentFilterGeom);
            const currentRawFilter = currentFilter as unknown as Record<string, unknown>;
            const currentOtherPoint = currentRawFilter[otherPointKey] as SheetPosition;

            const snappedPoint = applySnappingLineSeries(freePos, currentOtherPoint, {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              ctrlHeld: this.toolManager.getCtrlHeld(),
              superHeld: this.toolManager.getSuperHeld(),
              viewportScale: viewportControls.getState().viewport.scale,
            });

            this.getGeometryStore().updateByIdWithComponentDirect(filterId, FilterComponent, (g) =>
              FilterComponent.update(g, { [pointKey as string]: snappedPoint }),
            );
          },
          onCommit: (_sp) => {
            this.getHistoryManager().applyTransaction('mirror-filter-endpoint-move', () => {
              let afterFilterGeom = this.getGeometryStore().getByIdWithComponent(
                filterId,
                FilterComponent,
              );
              if (!afterFilterGeom) {
                return;
              }
              const afterFilter = FilterComponent.get(afterFilterGeom);
              const afterRawFilter = afterFilter as unknown as Record<string, unknown>;

              const finalPoint = afterRawFilter[pointKey as string] as SheetPosition;
              const finalOtherPoint = afterRawFilter[otherPointKey] as SheetPosition;

              const snappedFinal = applySnappingLineSeries(finalPoint, finalOtherPoint, {
                primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
                secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
                ctrlHeld: this.toolManager.getCtrlHeld(),
                superHeld: this.toolManager.getSuperHeld(),
                viewportScale: viewportControls.getState().viewport.scale,
              });

              this.getGeometryStore().updateByIdWithComponentDirect(
                filterId,
                FilterComponent,
                (g) => FilterComponent.update(g, { [pointKey as string]: snappedFinal }),
              );

              afterFilterGeom = this.getGeometryStore().getByIdWithComponent(
                filterId,
                FilterComponent,
              );
              if (!afterFilterGeom) {
                return;
              }
              const finalFilter = FilterComponent.get(afterFilterGeom);
              const finalRawFilter = finalFilter as unknown as Record<string, unknown>;

              const finalPointA = finalRawFilter.pointA as SheetPosition;
              const finalPointB = finalRawFilter.pointB as SheetPosition;

              const changed =
                originalPointA.x !== finalPointA.x ||
                originalPointA.y !== finalPointA.y ||
                originalPointB.x !== finalPointB.x ||
                originalPointB.y !== finalPointB.y;

              if (changed) {
                this.getHistoryManager().push(
                  UndoEntry.mirrorFilterMoveEndpoints(
                    filterId,
                    originalPointA,
                    originalPointB,
                    finalPointA,
                    finalPointB,
                  ),
                );
              }

              // After moving a filter endpoint, resync the filled state of any associated geometries
              this.getGeometryStore().updateByIdWithComponentDirect(
                filterData.geometryId,
                GeometryComponent,
                (geometry) => {
                  const [output, historyEvents] = FilterComponent.syncFillColor(
                    geometry,
                    this.getGeometryStore().findFiltersByGeometryId(geometry.id),
                  );
                  if (output !== geometry) {
                    for (const event of historyEvents) {
                      this.getHistoryManager().push(event);
                    }
                  }
                  return output;
                },
              );
            });
            this.activeDragListener = null;
          },
          onCancel: () => {
            const currentFilterGeom = this.getGeometryStore().getByIdWithComponent(
              filterId,
              FilterComponent,
            );
            if (currentFilterGeom) {
              this.getGeometryStore().updateByIdWithComponentDirect(
                filterId,
                FilterComponent,
                (g) =>
                  FilterComponent.update(g, {
                    pointA: originalPointA,
                    pointB: originalPointB,
                  }),
              );
            }
            this.activeDragListener = null;
          },
        });
        break;
      }
      default:
        filterData satisfies never;
        break;
    }
  }

  onConstraintLabelPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    constraintId: Constraint['id'],
  ): void {
    const constraintGeom = this.getGeometryStore().getByIdWithComponent(
      constraintId,
      ConstraintComponent,
    );
    if (!constraintGeom) {
      return;
    }
    const constraint = ConstraintComponent.get<ConstraintData>(constraintGeom);

    switch (constraint.type) {
      case 'linear':
        this.constraintLabelPointerDownPosition = screenPos;
        const beforeValue = constraint.connectorLineOffsetPx;

        this.activeDragListener = createDragListener({
          viewportControls,
          onMove: (sp) => {
            const liveViewport = viewportControls.getState().viewport;
            const sheetPos = sp.toWorld(liveViewport).toSheet();

            this.getGeometryStore().updateByIdWithComponentDirect(
              constraintId,
              ConstraintComponent,
              (g) => {
                const constraint = ConstraintComponent.get(g);
                const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(
                  constraint.pointA,
                );
                const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(
                  constraint.pointB,
                );
                if (!resolvedA || !resolvedB) {
                  return g;
                }
                if (constraint.type !== 'linear') {
                  return g;
                }

                let distPx: number;
                let sign: number;

                if (constraint.axis === 'x') {
                  const midY = (resolvedA.y + resolvedB.y) / 2;
                  distPx = Math.abs(sheetPos.y - midY) * SHEET_UNITS_TO_PIXELS * liveViewport.scale;
                  sign = sheetPos.y >= midY ? 1 : -1;
                } else if (constraint.axis === 'y') {
                  const midX = (resolvedA.x + resolvedB.x) / 2;
                  distPx = Math.abs(sheetPos.x - midX) * SHEET_UNITS_TO_PIXELS * liveViewport.scale;
                  sign = sheetPos.x >= midX ? 1 : -1;
                } else {
                  const { point: closest } = closestPointOnSegment(resolvedA, resolvedB, sheetPos);
                  distPx =
                    Vector2.distance(sheetPos, closest) *
                    SHEET_UNITS_TO_PIXELS *
                    liveViewport.scale;

                  const segDir = Vector2.sub(resolvedB, resolvedA);
                  const toQuery = Vector2.sub(sheetPos, resolvedA);
                  const cross = segDir.x * toQuery.y - segDir.y * toQuery.x;
                  sign = cross >= 0 ? 1 : -1;
                }

                return ConstraintComponent.update(g, {
                  connectorLineOffsetPx: sign * distPx,
                });
              },
            );
          },
          onCommit: (_sp) => {
            const afterGeom = this.getGeometryStore().getByIdWithComponent(
              constraintId,
              ConstraintComponent,
            );
            const after = afterGeom ? ConstraintComponent.get(afterGeom) : undefined;
            if (after && after.type === 'linear') {
              if (beforeValue !== after.connectorLineOffsetPx) {
                this.getHistoryManager().push(
                  UndoEntry.linearConstraintMoveLabel(
                    constraintId,
                    beforeValue,
                    after.connectorLineOffsetPx,
                  ),
                );
              }
            }
            this.activeDragListener = null;
          },
          onCancel: () => {
            this.getGeometryStore().updateByIdWithComponentDirect(
              constraintId,
              ConstraintComponent,
              (g) => ConstraintComponent.update(g, { connectorLineOffsetPx: beforeValue }),
            );
            this.activeDragListener = null;
          },
        });
        break;
      case 'perpendicular':
      case 'parallel':
      case 'horizontal':
      case 'vertical':
      case 'colinear':
      case 'coincident':
        break;
      default:
        constraint satisfies never;
        break;
    }
  }

  onConstraintLabelPointerUp(
    screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    constraintId: Constraint['id'],
    shiftKey: boolean,
  ): void {
    const alreadySelected = this.getSelectionManager().isSelected(constraintId);
    if (alreadySelected) {
      // If selected, then allow the user to change the value
      const constraintGeom = this.getGeometryStore().getByIdWithComponent(
        constraintId,
        ConstraintComponent,
      );
      if (!constraintGeom) {
        return;
      }
      const constraint = ConstraintComponent.get<ConstraintData>(constraintGeom);
      switch (constraint.type) {
        case 'linear':
          // Did the user drag their mouse while holding their mouse down?
          const didDragMouse =
            this.constraintLabelPointerDownPosition &&
            Vector2.distance(this.constraintLabelPointerDownPosition, screenPos) > 0;

          if (!didDragMouse) {
            this.getGeometryStore().setWorkingConstraints([
              {
                type: 'linear',
                pointA: constraint.pointA,
                pointB: constraint.pointB,
                constrainedLength: constraint.constrainedLength,
                connectorLineOffsetPx: -1 * constraint.connectorLineOffsetPx,
                axis: constraint.axis,
                disabled: false,

                // This hides `constraint` while this working constraint is visible.
                shadowsConstraintId: constraintId,
              },
            ]);
          }
          break;
        case 'perpendicular':
        case 'parallel':
        case 'horizontal':
        case 'vertical':
        case 'colinear':
        case 'coincident':
          break;
        default:
          constraint satisfies never;
          break;
      }
      return;
    }

    if (!shiftKey) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(constraintId);
  }

  /** Called when a constraint's label icon is hovered over. */
  onConstraintLabelPointerEnter(constraintId: Constraint['id']) {
    this.emit('hoveringConstraintLabelChange', constraintId);
  }
  /** Called when a constraint's label icon is no longer being hovered over. */
  onConstraintLabelPointerLeave() {
    this.emit('hoveringConstraintLabelChange', null);
  }

  // ==================== FILTER HANDLERS ====================

  onFilterLabelPointerUp(
    _screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    filterId: Filter['id'],
    shiftKey: boolean,
  ): void {
    const alreadySelected = this.getSelectionManager().isSelected(filterId);
    if (alreadySelected) {
      // If selected, then allow the user to change the value
      const geoemtry = this.getGeometryStore().getByIdWithComponent(filterId, FilterComponent);
      if (!geoemtry) {
        return;
      }
      const filter = FilterComponent.get<FilterData>(geoemtry);
      switch (filter.type) {
        case 'fillet':
        case 'chamfer':
          this.getGeometryStore().setWorkingFilter(
            filter.geometryType === 'polygon'
              ? {
                  type: filter.type,
                  offset: filter.offset,
                  geometryType: 'polygon',
                  geometryId: filter.geometryId,
                  pointAIndex: filter.pointAIndex,
                  pointCenterIndex: filter.pointCenterIndex,
                  pointBIndex: filter.pointBIndex,

                  // This hides `filter` while this working constraint is visible.
                  shadowsFilterId: filterId,
                }
              : {
                  type: filter.type,
                  offset: filter.offset,
                  geometryType: 'rectangle',
                  geometryId: filter.geometryId,
                  pointAKeyPoint: filter.pointAKeyPoint,
                  pointCenterKeyPoint: filter.pointCenterKeyPoint,
                  pointBKeyPoint: filter.pointBKeyPoint,

                  // This hides `filter` while this working constraint is visible.
                  shadowsFilterId: filterId,
                },
          );
          break;
        case 'mirror':
        case 'pattern':
          break;
        default:
          filter satisfies never;
          break;
      }
      return;
    }

    if (!shiftKey) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(filterId);
  }

  /** Called when a filter's label icon is hovered over. */
  onFilterLabelPointerEnter(filterId: Filter['id']) {
    this.emit('hoveringFilterLabelChange', filterId);
  }
  /** Called when a filter's label icon is no longer being hovered over. */
  onFilterLabelPointerLeave() {
    this.emit('hoveringFilterLabelChange', null);
  }

  /** Called when a user accepts a working filter's offset length. */
  onFilterLabelLengthInputAccept() {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    this.getHistoryManager().applyTransaction('sync-working-filter-offset', () => {
      const workingFilter = this.getGeometryStore().workingFilter;
      for (const filterId of selectedIds) {
        if (workingFilter?.shadowsFilterId === filterId) {
          switch (workingFilter.type) {
            case 'fillet':
            case 'chamfer':
              if (workingFilter.offset !== null) {
                const filter = this.getGeometryStore().getByIdWithComponent(
                  filterId,
                  FilterComponent,
                );
                if (!filter) {
                  return;
                }
                const filterData = FilterComponent.get(filter);
                if (filterData.type !== 'fillet' && filterData.type !== 'chamfer') {
                  return;
                }
                this.getHistoryManager().apply(
                  UndoEntry.filterChangeOffset(filterId, filterData.offset, workingFilter.offset),
                );
                break;
              }
            case 'mirror':
            case 'pattern':
              break;
            default:
              workingFilter satisfies never;
              break;
          }
        }
      }
    });
    this.getGeometryStore().clearWorkingFilter();
  }

  /** Called when a user rejects a working filter's entered offset length, resetting back to the old
   * pre-edited state. */
  onFilterLabelLengthInputDismiss() {
    this.getGeometryStore().clearWorkingFilter();
  }

  // ==================== FRAME HANDLERS ====================

  handleFrameFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    frameId: Id,
  ): boolean {
    return this.handleFillPointerDown(screenPos, viewportControls, frameId);
  }
}
