import { MousePointer2Icon } from 'lucide-react';
import { type DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import {
  Constraint,
  ConstraintComponent,
  type CubicBezierSegment,
  Datum,
  DatumComponent,
  Entity,
  EntityOmitComponents,
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
} from '@/lib/entity';
import { ID_PREFIXES, getPrefixFromId } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import {
  ConstrainedTrack,
  type ConstrainedTrackPath,
  ConstraintData,
  ConstraintEndpoint,
} from '@/lib/entity/constraints';
import { Filter, FilterData } from '@/lib/entity/filters';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { UndoEntry } from '@/lib/history/types';
import {
  BoundingBox,
  Vector2,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
} from '@/lib/math';
import {
  applyKeyPointSnapping,
  applySnapping,
  applySnappingOnConstrainedTrack,
} from '@/lib/snapping';
import { type UnitType } from '@/lib/units/length';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { ViewportControls } from '../viewport/ViewportControls';
import { Rect, ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
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
};

/** The pixels offset the selected bounded box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;

export type VisibleTooltip = 'add-point' | 'geometry-fill' | null;

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
function computeSelectionOrigin(states: Map<Id, DragState | null>): SheetPosition {
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
    if (bbox.position.x < minX) {
      minX = bbox.position.x;
    }
    if (bbox.position.y < minY) {
      minY = bbox.position.y;
    }
  }
  return new SheetPosition(minX, minY);
}

/** Returns the sheet position of a bounding box corner. */
function getCornerPosition(corner: ResizeCorner, bbox: Rect<SheetPosition>): SheetPosition {
  switch (corner) {
    case 'top-left':
      return bbox.position;
    case 'top-right':
      return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y);
    case 'bottom-left':
      return new SheetPosition(bbox.position.x, bbox.position.y + bbox.height);
    case 'bottom-right':
      return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y + bbox.height);
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

/** A representation of all entities which can be moved. The type is a union, and the associated
 * namespace has utility functions for computing metrics about the given entity in a generic way. */
type DragState =
  | { state: 'geometry', geometry: Entity<GeometryComponent> }
  | { state: 'datum', entity: Entity<DatumComponent> };

namespace DragState {
  /** Extracts the {@link DragState} from the passed {@link Entity}, or null if nothing could be computed. */
  export function get(entity: Entity): DragState | null {
    if (Entity.hasComponent(entity, GeometryComponent)) {
      return { state: 'geometry', geometry: Entity.pickComponent(entity, GeometryComponent) };
    } else if (Entity.hasComponent(entity, DatumComponent)) {
      return { state: 'datum', entity };
    }
    return null;
  }

  /** Takes a given {@link DragState} and updated the passed {@link Entity} to contin its data. */
  export function apply(state: DragState, entity: Entity): Entity {
    switch (state.state) {
      case 'geometry':
        return Entity.assignComponent(entity, GeometryComponent, state.geometry);
      case 'datum':
        return Entity.assignComponent(entity, DatumComponent, state.entity);
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
        return { ...state, geometry: GeometryComponent.translate(state.geometry, transform) };
      case 'datum':
        return { ...state, entity: DatumComponent.translate(state.entity, transform) };
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
      default:
        a satisfies never;
        throw new Error(`DragState.equals: No drag state case for ${(a as any).state}`);
    }
  }

  /** Returns the origin point of a {@link DragState}, corresponding to what the selection inspector
   *  shows as the shape's x/y position. For rectangle this is upperLeft, for ellipse it is center,
   *  for polygon it is the bounding box upper-left corner. */
  export function getOrigin(state: DragState): SheetPosition {
    switch (state.state) {
      case 'geometry':
        return GeometryComponent.getOrigin(state.geometry);
      case 'datum':
        return DatumComponent.getOrigin(state.entity);
      default:
        state satisfies never;
        throw new Error(`DragState.getOrigin: No drag state case for ${(state as any).state}`);
    }
  }

  /** Compute an axis aligned bounding box around the given {@link DragState}. */
  export function boundingBox(state: DragState): Rect<SheetPosition> {
    switch (state.state) {
      case 'geometry':
        return GeometryComponent.boundingBox(state.geometry);
      case 'datum':
        return {
          position: DatumComponent.getOrigin(state.entity),
          width: 0,
          height: 0,
        };
      default:
        state satisfies never;
        throw new Error(`DragState.boundingBox: No drag state case for ${(state as any).state}`);
    }
  }

  /** Takes the passed {@link DragState} and resizes the geometry using {@link ResizeParams}. */
  export function resize(
    state: DragState,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): DragState | null {
    switch (state.state) {
      case 'geometry':
        return { ...state, geometry: GeometryComponent.resize(state.geometry, params, originalBBox) };
      case 'datum':
        return null;
      default:
        state satisfies never;
        console.warn(
          `DragState.resize: Unknown state.for ${(state as any)?.for}. Doing nothing.`,
        );
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
  private originalPolygonState: { points: Array<PolygonSegment> } | null = null;
  /** Stores all locked point segments that move together (includes the dragged point). */
  private lockedPoints: Array<{ polygonId: Id; segmentIndex: number }> = [];
  /** Stores the original polygon state for each locked polygon for restore on cancel. */
  private originalLockedPolygonStates: Map<Id, Array<PolygonSegment>> = new Map();

  /** Constrained track result for the current drag operation. `'unconstrained'` when no constraints
   *  apply, `'immobile'` when constraints are contradictory, or an array of tracks to snap to. */
  private draggingConstrainedTrackResult: ConstrainedTrackPath = 'unconstrained';

  private draggingGeometryIds: Array<Id> | null = null;
  /** Resize mode when resizing via bounding box handles. */
  private resizeMode: ResizeMode | null = null;
  /** Original layout states for all geometries being resized, for restoring on cancel. */
  private resizeOriginalGroupStates: Map<Id, DragState> | null = null;
  /** Original union bounding box at start of resize. */
  private resizeOriginalUnionBBox: Rect<SheetPosition> | null = null;

  /** The initial position the user clicked when clicking on a constraint label. Used to determine
   * if the user just clicked, or clicked and dragged (which moves the label). */
  private constraintLabelPointerDownPosition: ScreenPosition | null = null;

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
    this.emit('hoveringPolygonSegmentChange', false);
    this.emit('hoveringConstraintLabelChange', null);
    this.cancelTooltip();
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
          const bbox = Entity.boundingBox(geometry);
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
  handleGeometryFillEnter(_id: Id): void {
    this.scheduleTooltip('geometry-fill', GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS);
  }

  /** Called by the renderer when the pointer leaves the fill area of a shape. */
  handleGeometryFillLeave(_id: Id): void {
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
    this.draggingConstrainedTrackResult = 'unconstrained';
    this.resizeMode = null;
    this.draggingGeometryIds = null;
    this.resizeOriginalGroupStates = null;
    this.resizeOriginalUnionBBox = null;
    this.emit('dragStateChange', null);
  }

  /** Handles key down events for polygon drawing and select tool shortcuts. */
  handleKeyDown(event: KeyboardEvent): boolean {
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
      const pointCount = polygonData.points.length;
      if (pointCount < 2) continue;

      // For closed polygons, we iterate all points (the last point connects back to the first).
      // For open polygons, we iterate up to the second-to-last point (the last point has no outgoing edge).
      const lastEdgeIndex = polygonData.closed ? pointCount - 1 : pointCount - 2;

      for (let i = 0; i <= lastEdgeIndex; i++) {
        const currentSeg = polygonData.points[i];
        const nextSegIndex = (i + 1) % pointCount;
        const nextSeg = polygonData.points[nextSegIndex];

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
    const beforePoint = polygonData.points[segmentIndex].point;

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = 'vertex';
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygonData.points.slice() };

    this.lockedPoints = [{ polygonId, segmentIndex }];
    this.originalLockedPolygonStates.clear();
    this.originalLockedPolygonStates.set(polygonId, polygonData.points.slice());

    const matchingPoints = this.getGeometryStore().findMatchingPoints(beforePoint, polygonId);
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
        [beforePoint],
        sheetConfig.defaultUnit,
        (ep) => this.getGeometryStore().resolveConstraintEndpoint(ep),
        sheetConfig.epsilon,
      );
      if (result !== 'unconstrained') {
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
          },
          this.getSheet()?.epsilon ?? 0.001,
        );

        this.getGeometryStore().updateByIdDirect(this.draggingPolygonId, (prev) => {
          if (!Entity.hasComponent(prev, GeometryComponent) || !GeometryComponent.isPolygon(prev)) {
            return prev;
          }
          const prevData = GeometryComponent.get(prev);
          const points = prevData.points.slice();
          const isFirstPointAndAtSamePositionAslastPoint =
            this.draggingSegmentIndex === 0 &&
            points.at(-1)?.point.x === points[0].point.x &&
            points.at(-1)?.point.y === points[0].point.y;

          points[this.draggingSegmentIndex] = {
            ...points[this.draggingSegmentIndex],
            point: snapped,
          };

          // If dragging the furst point, also drag the last point too, if the last point is at the
          // same position. This ensures that the first point of closed polygons (which have a final
          // point at the same position as the first point) can be moved properly without the last
          // point getting "stuck.
          if (isFirstPointAndAtSamePositionAslastPoint) {
            points[points.length - 1] = { ...points[points.length - 1], point: snapped };
          }

          return GeometryComponent.update(prev, { points }) as Entity;
        });

        // Move points which are at the same position in the same way as the selected polygon.
        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }

          this.getGeometryStore().updateByIdDirect(locked.polygonId, (prev) => {
            if (
              !Entity.hasComponent(prev, GeometryComponent) ||
              !GeometryComponent.isPolygon(prev)
            ) {
              return prev;
            }
            const prevData = GeometryComponent.get(prev);
            const points = prevData.points.slice();
            const isFirstPointAndAtSamePositionAsLastPoint =
              locked.segmentIndex === 0 &&
              points.at(-1)?.point.x === points[0].point.x &&
              points.at(-1)?.point.y === points[0].point.y;

            points[locked.segmentIndex] = {
              ...points[locked.segmentIndex],
              point: snapped,
            };

            if (isFirstPointAndAtSamePositionAsLastPoint) {
              points[points.length - 1] = { ...points[points.length - 1], point: snapped };
            }

            return GeometryComponent.update(prev, { points }) as Entity;
          });
        }
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();

        if (
          this.draggingPolygonId &&
          (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)
        ) {
          const moves: Array<{
            id: Id;
            segmentIndex: number;
            beforePoint: SheetPosition;
            afterPoint: SheetPosition;
          }> = [];

          moves.push({
            id: this.draggingPolygonId,
            segmentIndex: this.draggingSegmentIndex,
            beforePoint,
            afterPoint,
          });

          const mainPolygon = this.getGeometryStore().getByIdWithComponent(
            this.draggingPolygonId,
            GeometryComponent,
          );
          if (
            mainPolygon &&
            GeometryComponent.isPolygon(mainPolygon) &&
            this.draggingSegmentIndex === 0
          ) {
            const mainPolygonData = GeometryComponent.get(mainPolygon);
            const isFirstPointAndAtSamePositionAsLastPoint =
              mainPolygonData.points.at(-1)?.point.x === beforePoint.x &&
              mainPolygonData.points.at(-1)?.point.y === beforePoint.y;
            if (isFirstPointAndAtSamePositionAsLastPoint) {
              moves.push({
                id: this.draggingPolygonId,
                segmentIndex: mainPolygonData.points.length - 1,
                beforePoint,
                afterPoint,
              });
            }
          }

          for (const locked of this.lockedPoints) {
            if (locked.polygonId === this.draggingPolygonId) {
              continue;
            }

            const originalPoints = this.originalLockedPolygonStates.get(locked.polygonId);
            if (!originalPoints) {
              continue;
            }
            if (originalPoints[locked.segmentIndex].type === 'point') {
              const lockedBeforePoint = originalPoints[locked.segmentIndex].point;
              moves.push({
                id: locked.polygonId,
                segmentIndex: locked.segmentIndex,
                beforePoint: lockedBeforePoint,
                afterPoint,
              });

              if (locked.segmentIndex === 0) {
                const isFirstPointAndAtSamePositionAsLastPoint =
                  originalPoints.at(-1)?.point.x === lockedBeforePoint.x &&
                  originalPoints.at(-1)?.point.y === lockedBeforePoint.y;
                if (isFirstPointAndAtSamePositionAsLastPoint) {
                  moves.push({
                    id: locked.polygonId,
                    segmentIndex: originalPoints.length - 1,
                    beforePoint: lockedBeforePoint,
                    afterPoint,
                  });
                }
              }
            }
          }

          if (moves.length > 1) {
            this.getHistoryManager().push(UndoEntry.polygonMoveMultipleVertices(moves));
          } else {
            this.getHistoryManager().push(
              UndoEntry.polygonMoveVertex(
                this.draggingPolygonId,
                this.draggingSegmentIndex,
                beforePoint,
                afterPoint,
              ),
            );
          }
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

        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }
          const originalState = this.originalLockedPolygonStates.get(locked.polygonId);
          if (originalState) {
            this.getGeometryStore().updateByIdDirect(locked.polygonId, (prev) => {
              if (
                !Entity.hasComponent(prev, GeometryComponent) ||
                !GeometryComponent.isPolygon(prev)
              ) {
                return prev;
              }
              return GeometryComponent.update(prev, { points: originalState.slice() }) as Entity;
            });
          }
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
    let beforePoint: SheetPosition;
    if (pointKey === 'controlPoint') {
      beforePoint = (ctrlPolygonData.points[segmentIndex] as QuadraticBezierSegment).controlPoint;
    } else {
      beforePoint = (ctrlPolygonData.points[segmentIndex] as CubicBezierSegment)[pointKey];
    }

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
        });

        this.getGeometryStore().updateByIdDirect(this.draggingPolygonId, (prev) => {
          if (!Entity.hasComponent(prev, GeometryComponent) || !GeometryComponent.isPolygon(prev)) {
            return prev;
          }
          const prevData = GeometryComponent.get(prev);
          const segments = prevData.points.slice();
          if (this.draggingPointKey === 'controlPoint') {
            const seg = segments[this.draggingSegmentIndex] as QuadraticBezierSegment;
            segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snapped };
          } else {
            const seg = segments[this.draggingSegmentIndex] as CubicBezierSegment;
            segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snapped };
          }
          return GeometryComponent.update(prev, { points: segments }) as Entity;
        });
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();
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

      default:
        constraint satisfies never;
        throw new Error(
          `buildSingleConstrainedTrack: unexpected constraint type ${(constraint as any).type}`,
        );
    }
  }

  // ==================== COMMON GEOMETEY  HANDLERS ====================

  handleGeometryFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    geometryId: Id,
  ): boolean {
    return this.handleFillPointerDown(screenPos, viewportControls, geometryId);
  }

  private handleFillPointerDown (
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    entityId: Entity['id'],
  ): boolean {
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
          return [[id, DragState.get(geom)]];
        }),
      );
    }
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
        const snapped = applySnappingOnConstrainedTrack(
          sheet,
          this.draggingConstrainedTrackResult,
          {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
          },
          this.getSheet()?.epsilon ?? 0.001,
        );

        // Compute the origin of the selection for snapping purposes.
        // For a single shape this is the selection-inspector x/y (upperLeft for rect,
        // center for ellipse, bounding box upper-left for polygon). For multi-selection
        // it is the upper-left of the union bounding box.
        const selectionOrigin = computeSelectionOrigin(this.originalDragState);

        // Cursor delta in snapped space (same as before)
        const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
        const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);

        // Where the origin would land if it followed the cursor
        const rawNewOrigin = new SheetPosition(selectionOrigin.x + dx, selectionOrigin.y + dy);

        // Snap only the origin to the grid (skip if ctrl held or constraint tracks are active)
        let snappedOrigin = rawNewOrigin;
        if (
          !this.toolManager.getCtrlHeld() &&
          this.draggingConstrainedTrackResult === 'unconstrained'
        ) {
          snappedOrigin = applySnapping(rawNewOrigin, {
            primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
            secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
            ctrlHeld: this.toolManager.getCtrlHeld(),
            superHeld: false,
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
          if (!DragState.equals(state, newState)) {
            // FIXME: replace with one single event
            switch (state.state) {
              case 'geometry':
                if (!Entity.hasComponent(entity, GeometryComponent)) {
                  // FIXME: add log
                  return;
                }
                if (GeometryComponent.isPolygon(state.geometry) && GeometryComponent.isPolygon(entity)) {
                  const before = GeometryComponent.get(state.geometry);
                  const after = GeometryComponent.get(entity);
                  forwardsActions.push(UndoEntry.polygonMove(id, before.points, after.points));
                } else if (GeometryComponent.isEllipse(state.geometry) && GeometryComponent.isEllipse(entity)) {
                  const before = GeometryComponent.get(state.geometry);
                  const after = GeometryComponent.get(entity);
                  forwardsActions.push(UndoEntry.ellipseMove(id, before, after));
                } else if (GeometryComponent.isRectangle(state.geometry) && GeometryComponent.isRectangle(entity)) {
                  const before = GeometryComponent.get(state.geometry);
                  const after = GeometryComponent.get(entity);
                  forwardsActions.push(UndoEntry.rectangleMove(id, before, after));
                }
                break;
              case 'datum':
                if (!Entity.hasComponent(entity, DatumComponent)) {
                  // FIXME: add log
                  return;
                }
                const before = DatumComponent.get(state.entity);
                const after = DatumComponent.get(entity);
                // FIXME: make this history entry take just before / after, not wrapped in the object
                forwardsActions.push(UndoEntry.datumMove(id, { position: before }, { position: after }));
                break;
              default:
                state satisfies never;
                console.warn(
                  `SelectTool.onCommit: untracked layout state.for "${(state as any).for}"`,
                );
                break;
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
            this.getGeometryStore().updateByIdDirect(id, (old) =>
              DragState.apply(state, old),
            );
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

  /** Starts resizing one or more geometries via a corner or edge handle of the bounding box. */
  onGeometryResizePointerDown(
    viewportControls: ViewportControls,
    geometryIds: Array<Id>,
    resizeMode: ResizeMode,
  ): void {
    // Capture original layout states for all geometries
    const originalStates = new Map<Id, DragState>();
    for (const id of geometryIds) {
      const geometry = this.getGeometryStore().getById(id);
      if (!geometry) {
        continue;
      }
      const state = DragState.get(geometry);
      if (state) {
        originalStates.set(id, state);
      }
    }
    if (originalStates.size === 0) {
      return;
    }

    // Compute original union bounding box
    let unionBBox: Rect<SheetPosition> | null = null;
    for (const state of originalStates.values()) {
      const bbox = DragState.boundingBox(state);

      if (!unionBBox) {
        unionBBox = bbox;
      } else {
        const minX = Math.min(unionBBox.position.x, bbox.position.x);
        const minY = Math.min(unionBBox.position.y, bbox.position.y);
        const maxX = Math.max(unionBBox.position.x + unionBBox.width, bbox.position.x + bbox.width);
        const maxY = Math.max(
          unionBBox.position.y + unionBBox.height,
          bbox.position.y + bbox.height,
        );
        unionBBox = {
          position: new SheetPosition(minX, minY),
          width: maxX - minX,
          height: maxY - minY,
        };
      }
    }
    if (!unionBBox) {
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
    this.resizeOriginalUnionBBox = unionBBox;
    this.draggingGeometryIds = geometryIds;
    this.emit('dragStateChange', {
      type: 'geometry-resize',
      ids: geometryIds,
      mode: resizeMode,
    });

    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    if (resizeMode.type === 'corner') {
      switch (resizeMode.corner) {
        case 'top-left':
          initialPointerDownOffsetXPx = SELECTED_OUTSET_PX;
          initialPointerDownOffsetYPx = SELECTED_OUTSET_PX;
          break;
        case 'top-right':
          initialPointerDownOffsetXPx = -1 * SELECTED_OUTSET_PX;
          initialPointerDownOffsetYPx = SELECTED_OUTSET_PX;
          break;
        case 'bottom-left':
          initialPointerDownOffsetXPx = SELECTED_OUTSET_PX;
          initialPointerDownOffsetYPx = -1 * SELECTED_OUTSET_PX;
          break;
        case 'bottom-right':
          initialPointerDownOffsetXPx = -1 * SELECTED_OUTSET_PX;
          initialPointerDownOffsetYPx = -1 * SELECTED_OUTSET_PX;
          break;
      }
    } else {
      switch (resizeMode.edge) {
        case 'top':
          initialPointerDownOffsetYPx = SELECTED_OUTSET_PX;
          break;
        case 'bottom':
          initialPointerDownOffsetYPx = -1 * SELECTED_OUTSET_PX;
          break;
        case 'left':
          initialPointerDownOffsetXPx = SELECTED_OUTSET_PX;
          break;
        case 'right':
          initialPointerDownOffsetXPx = -1 * SELECTED_OUTSET_PX;
          break;
      }
    }

    if (resizeMode.type === 'corner') {
      this.draggingConstrainedTrackResult = this.computeCornerResizeTracks(
        geometryIds[0],
        resizeMode.corner,
        unionBBox,
      );
    } else if (resizeMode.type === 'edge') {
      this.draggingConstrainedTrackResult = this.computeEdgeResizeTracks(
        geometryIds[0],
        resizeMode.edge,
        unionBBox,
      );
    }

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        const groupStates = this.resizeOriginalGroupStates;
        const unionBBox = this.resizeOriginalUnionBBox;
        if (!this.draggingGeometryIds || !this.resizeMode || !unionBBox || !groupStates) {
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

        // Compute new union bounding box
        const newUnionBBox = GeometryComponent.resizeBBox(unionBBox, params);
        if (!newUnionBBox) {
          return;
        }

        // Apply percentage-based resize to each geometry
        for (const [id, originalState] of groupStates) {
          const newState = DragState.resize(originalState, params, unionBBox);
          if (newState) {
            this.getGeometryStore().updateByIdDirect(id, (old) =>
              DragState.apply(newState, old),
            );
          }
        }
      },
      onCommit: (_sp) => {
        if (this.resizeOriginalGroupStates && this.draggingGeometryIds) {
          this.getHistoryManager().applyTransaction('geometry-resize', () => {
            for (const [id, originalState] of this.resizeOriginalGroupStates!) {
              const afterGeometry = this.getGeometryStore().getById(id);
              if (!afterGeometry) {
                continue;
              }
              const afterState = DragState.get(afterGeometry);
              if (!afterState || DragState.equals(originalState, afterState)) {
                continue;
              }

              // FIXME: replace with one single event
              switch (originalState.state) {
                case 'geometry':
                  if (!Entity.hasComponent(afterGeometry, GeometryComponent)) {
                    // FIXME: add log
                    return;
                  }
                  if (GeometryComponent.isPolygon(originalState.geometry) && GeometryComponent.isPolygon(afterGeometry)) {
                    const before = GeometryComponent.get(originalState.geometry);
                    const after = GeometryComponent.get(afterGeometry);
                    this.getHistoryManager().push(
                      UndoEntry.polygonMove(id, before.points, after.points)
                    );
                  } else if (GeometryComponent.isEllipse(originalState.geometry) && GeometryComponent.isEllipse(afterGeometry)) {
                    const before = GeometryComponent.get(originalState.geometry);
                    const after = GeometryComponent.get(afterGeometry);
                    this.getHistoryManager().push(
                      UndoEntry.ellipseMove(id, before, after),
                    );
                  } else if (GeometryComponent.isRectangle(originalState.geometry) && GeometryComponent.isRectangle(afterGeometry)) {
                    const before = GeometryComponent.get(originalState.geometry);
                    const after = GeometryComponent.get(afterGeometry);
                    this.getHistoryManager().push(
                      UndoEntry.rectangleMove(id, before, after),
                    );
                  }
                  break;
                case 'datum':
                  console.warn('SelectTool.onCommit: Datum was resized, but this should not be possible. Doing nothing.');
                  break;
                default:
                  originalState satisfies never;
                  console.warn(
                    `SelectTool.onCommit: untracked layout originalState.state "${(originalState as any).state}"`,
                  );
                  break;
              }
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
    geometryId: Id,
    corner: ResizeCorner,
    unionBBox: Rect<SheetPosition>,
  ): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return 'unconstrained';
    }

    const matchedConstraints = this.getGeometryStore().findConstraintsByGeometryId(geometryId);
    if (matchedConstraints.length === 0) {
      return 'unconstrained';
    }

    const cornerPos = getCornerPosition(corner, unionBBox);

    const tracks: Array<ConstrainedTrack> = [];

    for (const c of matchedConstraints) {
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
      return 'unconstrained';
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
        return 'immobile';
      }
      result = next;
    }
    return result;
  }

  /**
   * Computes constrained tracks for an edge resize.
   *
   * For rectangles and ellipses, restricts constraint tracks to the edge's movement axis
   * (1D) since endpoints on the dragged edge move in only one coordinate.  For polygons,
   * uses the same 2D offset approach as corner resize since vertices scale proportionally.
   */
  private computeEdgeResizeTracks(
    geometryId: Id,
    edge: ResizeEdge,
    unionBBox: Rect<SheetPosition>,
  ): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return 'unconstrained';
    }

    const matchedConstraints = this.getGeometryStore().findConstraintsByGeometryId(geometryId);
    if (matchedConstraints.length === 0) {
      return 'unconstrained';
    }

    const tracks: Array<ConstrainedTrack> = [];

    for (const c of matchedConstraints) {
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

      if (!isEndpointOnEdge(built.shapeEndpoint, edge, built.endpointPos, unionBBox)) {
        continue;
      }

      const axis = edge === 'top' || edge === 'bottom' ? 'y' : 'x';
      const fixedCoord = axis === 'y' ? built.endpointPos.x : built.endpointPos.y;
      const restricted = ConstrainedTrack.restrictToAxis(
        built.track,
        fixedCoord,
        axis,
        sheetConfig.epsilon,
      );
      if (restricted === 'immobile') {
        return 'immobile';
      }
      if (restricted !== null) {
        tracks.push(restricted);
      }
    }

    if (tracks.length === 0) {
      return 'unconstrained';
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
        return 'immobile';
      }
      result = next;
    }
    return result;
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
      return 'unconstrained';
    }

    const matchedGeometryIdConstraintsPairs = geometryIds.flatMap((id) =>
      this.getGeometryStore()
        .findConstraintsByGeometryId(id)
        .map((c) => [id, c] as const),
    );
    if (matchedGeometryIdConstraintsPairs.length === 0) {
      return 'unconstrained';
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
      return 'unconstrained';
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
        return 'immobile';
      }
      result = next;
    }
    return result;
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
    this.getGeometryStore().addPointOnLineSegmentEdge(polygonId, segmentIndex, sheetPos);
  }

  /** Adds a point on the specified quadratic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnQuadraticEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const geom = this.getGeometryStore().getByIdWithComponent(polygonId, GeometryComponent);
    if (!geom || !GeometryComponent.isPolygon(geom)) {
      return;
    }

    const quadPolygonData = GeometryComponent.get(geom);
    const pointSegment = quadPolygonData.points[segmentIndex];
    const arcSegment = quadPolygonData.points[segmentIndex + 1];
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

    const cubicPolygonData = GeometryComponent.get(geom);
    const pointSegment = cubicPolygonData.points[segmentIndex];
    const arcSegment = cubicPolygonData.points[segmentIndex + 1];
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

    createDragListener({
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
        });
        this.emit('keyPointSnapChange', null);
        this.emit('snapHintsVisibilityChange', null);
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
      },
    });
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

        createDragListener({
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
          },
          onCancel: () => {
            this.getGeometryStore().updateByIdWithComponentDirect(
              constraintId,
              ConstraintComponent,
              (g) => ConstraintComponent.update(g, { connectorLineOffsetPx: beforeValue }),
            );
          },
        });
        break;
      case 'perpendicular':
      case 'parallel':
      case 'horizontal':
      case 'vertical':
      case 'colinear':
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
                this.getGeometryStore().updateByIdWithComponent(filterId, FilterComponent, (g) =>
                  FilterComponent.update(g, { offset: workingFilter.offset! }),
                );
                break;
              }
            case 'mirror':
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
}
