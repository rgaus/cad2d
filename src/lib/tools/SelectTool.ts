import { type DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import {
  Constraint,
  type CubicBezierSegment,
  type Ellipse,
  EllipseComponent,
  EllipseTemplate,
  FillColorComponent,
  Geometry,
  GeometryOmitComponents,
  type Id,
  LinkDimensionsComponent,
  type Polygon,
  PolygonComponent,
  PolygonSegment,
  PolygonTemplate,
  type QuadraticBezierSegment,
  type Rectangle,
  RectangleComponent,
  type RectangleEndpoint,
  RectangleTemplate,
  RenderOrderComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  ConstrainedTrack,
  type ConstrainedTrackPath,
  ConstraintEndpoint,
} from '@/lib/geometry/constraints';
import { UndoEntry } from '@/lib/history/types';
import {
  applyKeyPointSnapping,
  applySnapping,
  applySnappingOnConstrainedTrack,
  snapToNearestGrid,
} from '@/lib/snapping';
import { type UnitType } from '@/lib/units/length';
import {
  boundingBox,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
  distance,
  subVec2,
} from '../math';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { ViewportControls } from '../viewport/ViewportControls';
import { type Rect, ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { type DraggingShapeState, type ResizeCorner, type ResizeEdge } from './types';

/** Events emitted by SelectTool. */
export type SelectToolEvents = {
  dragStateChange: (draggingShapeState: DraggingShapeState | null) => void;
  closestPointToSegmentChange: (
    closestPoint: { polygonId: Id; segmentIndex: number; point: SheetPosition } | null,
  ) => void;
  hoveringPolygonSegmentChange: (hovering: boolean) => void;
  keyPointSnapChange: (
    snapInfo: { endpoint: ConstraintEndpoint; screenPosition: ScreenPosition } | null,
  ) => void;
};

/** Resize mode indicating which handle is being dragged. */
export type ResizeMode =
  | { type: 'corner'; corner: ResizeCorner }
  | { type: 'edge'; edge: ResizeEdge };

/** The pixels offset the selected bounded box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;

export type VisibleTooltip = 'add-point' | 'geometry-fill' | null;

/** Timeout before a tooltip shows up next to a user's mouse giving them hints on what they can do
 * with the geometry - alt drag to duplicate, etc */
const GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS = 500;

const ADD_POINT_TOOLTIP_TIMEOUT_MS = 100;

/** A tool for selecting / manipulating polygons. */
export class SelectTool extends BaseTool<SelectToolEvents> {
  type = 'select' as const;
  focusKeyCombo = 's' as const;

  /** The current arc drawing mode. */
  public arcDrawMode: 'quadratic' | 'cubic' = 'quadratic';
  public isHoveringFirstHandle: boolean = false;
  /** Whether the Alt key was held at the moment the user started hovering the first handle. */
  private altHeldOnFirstHandleHover: boolean = false;

  private activeDragListener: DragListener | null = null;
  private draggingPolygonId: Id | null = null;
  private draggingSegmentIndex: number = -1;
  private draggingPointKey: string = '';
  private dragStartSheetPos: SheetPosition | null = null;
  /** Stores the original polygon state for restore on cancel. */
  private originalPolygonState: { points: Array<PolygonSegment> } | null = null;
  /** Stores all locked point segments that move together (includes the dragged point). */
  private lockedPoints: Array<{ polygonId: Id; segmentIndex: number }> = [];
  /** Stores the original polygon state for each locked polygon for restore on cancel. */
  private originalLockedPolygonStates: Map<Id, Array<PolygonSegment>> = new Map();

  /** Constrained track result for the current drag operation. `'unconstrained'` when no constraints
   *  apply, `'immobile'` when constraints are contradictory, or an array of tracks to snap to. */
  private draggingConstrainedTrackResult: ConstrainedTrackPath = 'unconstrained';

  /** Resize mode when resizing via bounding box handles. */
  private resizeMode: ResizeMode | null = null;
  /** Original bounding box at start of resize. */
  private resizeOriginalBoundingBox: Rect<SheetPosition> | null = null;
  /** Original polygon points at start of resize. */
  private resizeOriginalPoints: Array<PolygonSegment> | null = null;

  /** The initial position the user clicked when clicking on a constraint label. Used to determine
   * if the user just clicked, or clicked and dragged (which moves the label). */
  private constraintLabelPointerDownPosition: ScreenPosition | null = null;

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
    this.emit('hoveringPolygonSegmentChange', false);
    this.cancelTooltip();
  }

  /** Called by the renderer when the pointer enters the fill area of a shape. */
  onEnterGeometryFill(_id: Id): void {
    this.scheduleTooltip('geometry-fill', GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS);
  }

  /** Called by the renderer when the pointer leaves the fill area of a shape. */
  onLeaveGeometryFill(_id: Id): void {
    this.cancelTooltip();
  }

  /** Returns the ID of the polygon currently being dragged, or null if no drag is active. */
  getDraggingPolygonId(): Id | null {
    return this.draggingPolygonId;
  }

  /** Cancels the active drag operation and restores the polygon to its original state. */
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
    this.originalPolygonState = null;
    this.lockedPoints = [];
    this.originalLockedPolygonStates.clear();
    this.draggingConstrainedTrackResult = 'unconstrained';
    this.resizeMode = null;
    this.resizeOriginalBoundingBox = null;
    this.resizeOriginalPoints = null;
    this.emit('dragStateChange', null);
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.isHoveringFirstHandle = false;
    this.altHeldOnFirstHandleHover = false;
  }

  /** Computes the snapped position for the polygon tool preview. */
  computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });
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
              this.getGeometryStore().updateConstraint(constraintId, {
                constrainedLength: wc.constrainedLength,
              });
              break;
          }
        }
        this.getGeometryStore().clearWorkingConstraints();
        return true;
      }
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
      const polygon = this.getGeometryStore().polygons.find((p) => p.id === id);
      if (!polygon) continue;

      const polygonData = PolygonComponent.get(polygon);
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

  /** Called by the renderer when a polygon fill is clicked in select mode. */
  handlePolygonSelect(polygonId: Id, addToSelection: boolean): void {
    if (!addToSelection) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(polygonId);
  }

  /** Starts dragging a vertex handle. Called from renderer pointer down on vertex handles. */
  onVertexPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    polygonId: Id,
    segmentIndex: number,
  ) {
    const polygon = this.getGeometryStore().polygons.find((p) => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const polygonData = PolygonComponent.get(polygon);
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
      const otherPolygon = this.getGeometryStore().polygons.find((p) => p.id === match.polygonId);
      if (otherPolygon) {
        this.originalLockedPolygonStates.set(
          match.polygonId,
          PolygonComponent.get(otherPolygon).points.slice(),
        );
      }
    }

    // Find constraints attached to this vertex via locked-polygon endpoints
    const matchedConstraints = this.getGeometryStore().constraints.filter((c) => {
      if (c.type !== 'linear') {
        return false;
      }
      return (
        (c.pointA.type === 'locked-polygon' &&
          c.pointA.id === polygonId &&
          c.pointA.pointIndex === segmentIndex) ||
        (c.pointB.type === 'locked-polygon' &&
          c.pointB.id === polygonId &&
          c.pointB.pointIndex === segmentIndex)
      );
    });

    const sheetConfig = this.getSheet();
    if (matchedConstraints.length > 0 && sheetConfig) {
      const result = Constraint.computeConstrainedTracksForPoints(
        matchedConstraints,
        [beforePoint],
        sheetConfig.defaultUnit,
        (ep) => this.getGeometryStore().resolveConstraintEndpoint(ep),
      );
      if (result === 'immobile') {
        this.draggingConstrainedTrackResult = 'immobile';
      } else if (result !== 'unconstrained') {
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
            shiftHeld: this.toolManager.getShiftHeld(),
            superHeld: false,
          },
        );

        this.getGeometryStore().updateByIdWithComponentDirect(
          this.draggingPolygonId,
          PolygonComponent,
          (prev) => {
            const prevData = PolygonComponent.get(prev);
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

            return PolygonComponent.update(prev, { ...prevData, points });
          },
        );

        // Move points which are at the same position in the same way as the selected polygon.
        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }

          this.getGeometryStore().updateByIdWithComponentDirect(
            locked.polygonId,
            PolygonComponent,
            (prev) => {
              const prevData = PolygonComponent.get(prev);
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

              return PolygonComponent.update(prev, { ...prevData, points });
            },
          );
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

          const mainPolygon = this.getGeometryStore().polygons.find(
            (p) => p.id === this.draggingPolygonId,
          );
          if (mainPolygon && this.draggingSegmentIndex === 0) {
            const mainPolygonData = PolygonComponent.get(mainPolygon);
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

            const polygon = this.getGeometryStore().polygons.find((p) => p.id === locked.polygonId);
            if (!polygon) {
              continue;
            }
            const polygonData = PolygonComponent.get(polygon);
            if (polygonData.points[locked.segmentIndex].type === 'point') {
              const lockedBeforePoint = polygonData.points[locked.segmentIndex].point;
              moves.push({
                id: locked.polygonId,
                segmentIndex: locked.segmentIndex,
                beforePoint: lockedBeforePoint,
                afterPoint,
              });

              if (locked.segmentIndex === 0) {
                const isFirstPointAndAtSamePositionAsLastPoint =
                  polygonData.points.at(-1)?.point.x === lockedBeforePoint.x &&
                  polygonData.points.at(-1)?.point.y === lockedBeforePoint.y;
                if (isFirstPointAndAtSamePositionAsLastPoint) {
                  moves.push({
                    id: locked.polygonId,
                    segmentIndex: polygonData.points.length - 1,
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
          this.getGeometryStore().updateByIdWithComponentDirect(
            this.draggingPolygonId,
            PolygonComponent,
            (prev) => {
              return PolygonComponent.update(prev, {
                points: this.originalPolygonState!.points.slice(),
              });
            },
          );
        }

        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }
          const originalState = this.originalLockedPolygonStates.get(locked.polygonId);
          if (originalState) {
            this.getGeometryStore().updateByIdWithComponentDirect(
              locked.polygonId,
              PolygonComponent,
              (prev) => {
                return PolygonComponent.update(prev, { points: originalState.slice() });
              },
            );
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
    const polygon = this.getGeometryStore().polygons.find((p) => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const ctrlPolygonData = PolygonComponent.get(polygon);
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
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        this.getGeometryStore().updateByIdWithComponentDirect(
          this.draggingPolygonId,
          PolygonComponent,
          (prev) => {
            const prevData = PolygonComponent.get(prev);
            const segments = prevData.points.slice();
            if (this.draggingPointKey === 'controlPoint') {
              const seg = segments[this.draggingSegmentIndex] as QuadraticBezierSegment;
              segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snapped };
            } else {
              const seg = segments[this.draggingSegmentIndex] as CubicBezierSegment;
              segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snapped };
            }
            return PolygonComponent.update(prev, { ...prevData, points: segments });
          },
        );
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
          this.getGeometryStore().updateByIdWithComponentDirect(
            this.draggingPolygonId,
            PolygonComponent,
            (prev) => {
              return PolygonComponent.update(prev, {
                points: this.originalPolygonState!.points.slice(),
              });
            },
          );
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
    c: Constraint,
    geometryId: Id,
    sheetUnit: UnitType,
  ): {
    track: ConstrainedTrack;
    endpointPos: SheetPosition;
    shapeEndpoint: ConstraintEndpoint;
  } | null {
    switch (c.type) {
      case 'linear': {
        if (c.constrainedLength === null) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          (ep.type === 'locked-rectangle' ||
            ep.type === 'locked-ellipse' ||
            ep.type === 'locked-polygon') &&
          ep.id === geometryId;

        const aAttached = attached(c.pointA);
        const bAttached = attached(c.pointB);

        // Skip if both or neither are attached — no single moving endpoint
        if (aAttached === bAttached) {
          return null;
        }

        const shapeEndpoint = aAttached ? c.pointA : c.pointB;
        const fixedEndpoint = aAttached ? c.pointB : c.pointA;

        const store = this.getGeometryStore();
        const endpointPos = store.resolveConstraintEndpoint(shapeEndpoint);
        const fixedPos = store.resolveConstraintEndpoint(fixedEndpoint);
        if (!endpointPos || !fixedPos) {
          return null;
        }

        const radius = c.constrainedLength.toSheetUnits(sheetUnit).magnitude;
        return {
          track: { type: 'circle' as const, center: fixedPos, radius },
          endpointPos,
          shapeEndpoint,
        };
      }

      default: {
        return null;
      }
    }
  }

  /**
   * Computes anchor-relative constrained tracks for a shape whose fill is being dragged.
   * Finds all constraints referencing `geometryId` where exactly one endpoint is on the shape,
   * computes the track for the fixed endpoint, then offsets it so the track applies to the
   * shape's movement anchor rather than the specific key point.
   *
   * Sets `draggingConstrainedTrackResult` as appropriate.
   */
  private computeShapeMoveTracks(geometryId: Id, anchorPosition: SheetPosition): void {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return;
    }

    const matchedConstraints = this.getGeometryStore().findConstraintsByGeometryId(geometryId);
    if (matchedConstraints.length === 0) {
      return;
    }

    const tracks: Array<ConstrainedTrack> = [];

    for (const c of matchedConstraints) {
      const built = this.buildSingleConstrainedTrack(c, geometryId, sheetConfig.defaultUnit);
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
      return;
    }

    // Reduce all tracks together
    let result: Array<ConstrainedTrack> = [tracks[0]];
    for (let i = 1; i < tracks.length; i += 1) {
      const next: Array<ConstrainedTrack> = [];
      for (const existing of result) {
        const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i]);
        if (intersection === 'immobile') {
          continue;
        }
        next.push(...intersection);
      }
      if (next.length === 0) {
        this.draggingConstrainedTrackResult = 'immobile';
        return;
      }
      result = next;
    }
    this.draggingConstrainedTrackResult = result;
  }

  /**
   * Computes constrained tracks for a rectangle corner resize.
   * Only handles constraints on the dragged corner (offset = 0 — track applies directly to
   * the snapped cursor position). Constraints on adjacent or opposite corners are skipped.
   *
   * Sets `draggingConstrainedTrackResult` as appropriate.
   */
  private computeCornerResizeTracks(geometryId: Id, corner: ResizeCorner): void {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return;
    }

    const matchedConstraints = this.getGeometryStore().findConstraintsByGeometryId(geometryId);
    if (matchedConstraints.length === 0) {
      return;
    }

    // Map ResizeCorner to the RectangleEndpoint that IS the dragged corner
    const cornerToEndpoint: Record<ResizeCorner, RectangleEndpoint> = {
      'top-left': 'upperLeft',
      'top-right': 'upperRight',
      'bottom-left': 'lowerLeft',
      'bottom-right': 'lowerRight',
    };
    const dragEndpoint = cornerToEndpoint[corner];

    const tracks: Array<ConstrainedTrack> = [];

    for (const c of matchedConstraints) {
      const built = this.buildSingleConstrainedTrack(c, geometryId, sheetConfig.defaultUnit);
      if (!built) {
        continue;
      }

      // Only handle constraints on the dragged corner (offset = 0)
      if (
        built.shapeEndpoint.type !== 'locked-rectangle' ||
        built.shapeEndpoint.point !== dragEndpoint
      ) {
        continue;
      }

      tracks.push(built.track);
    }

    if (tracks.length === 0) {
      return;
    }

    // Reduce all tracks together
    let result: Array<ConstrainedTrack> = [tracks[0]];
    for (let i = 1; i < tracks.length; i += 1) {
      const next: Array<ConstrainedTrack> = [];
      for (const existing of result) {
        const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i]);
        if (intersection === 'immobile') {
          continue;
        }
        next.push(...intersection);
      }
      if (next.length === 0) {
        this.draggingConstrainedTrackResult = 'immobile';
        return;
      }
      result = next;
    }
    this.draggingConstrainedTrackResult = result;
  }

  onPolygonFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    polygonId: Id,
  ): void {
    const polygon = this.getGeometryStore().getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon || !Geometry.hasComponent(polygon, RenderOrderComponent)) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the polygon, and start dragging the duplicate, not the
    // original
    if (this.toolManager.getAltHeld()) {
      let polygonWithoutId: Partial<GeometryOmitComponents<Polygon, RenderOrderComponent>> =
        RenderOrderComponent.remove({ ...polygon });
      delete polygonWithoutId.id;
      this.draggingPolygonId = this.getGeometryStore().addPolygon(
        polygonWithoutId as PolygonTemplate,
      ).id;
      this.getSelectionManager().deselect(polygon.id).select(this.draggingPolygonId);
    } else {
      this.draggingPolygonId = polygonId;
    }

    this.dragStartSheetPos = snapped;
    this.originalPolygonState = { points: PolygonComponent.get(polygon).points.slice() };
    this.computeShapeMoveTracks(this.draggingPolygonId, this.dragStartSheetPos);

    // NOTE: wait to emit the `dragStateChange` event until the mouse moves, because otherwise then
    // clicks will be seen as drags and clicking on polygons is also used for selecting.
    let initialDragStateChangeEmitted = false;

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!initialDragStateChangeEmitted) {
          this.emit('dragStateChange', { type: 'polygon', polygonId });
          initialDragStateChangeEmitted = true;
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
            shiftHeld: this.toolManager.getShiftHeld(),
            superHeld: false,
          },
        );

        if (!this.draggingPolygonId) {
          return;
        }
        this.getGeometryStore().updateByIdWithComponentDirect(
          this.draggingPolygonId,
          PolygonComponent,
          (polygon) => {
            if (!this.originalPolygonState) {
              return polygon;
            }
            const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
            const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);
            const snapIfNotShifted = (pos: SheetPosition): SheetPosition => {
              if (!this.toolManager.getShiftHeld()) {
                return snapToNearestGrid(
                  pos,
                  this.toolManager.snappingOptions.primaryGridSize,
                  this.toolManager.snappingOptions.secondaryGridSize,
                );
              }
              return pos;
            };
            const newPoints = this.originalPolygonState.points.map((seg) => {
              const newSeg: typeof seg = { ...seg };
              newSeg.point = snapIfNotShifted(
                new SheetPosition(seg.point.x + dx, seg.point.y + dy),
              );
              if (PolygonSegment.isQuadratic(seg)) {
                (newSeg as typeof seg & { controlPoint: SheetPosition }).controlPoint =
                  snapIfNotShifted(
                    new SheetPosition(
                      (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint.x + dx,
                      (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint.y + dy,
                    ),
                  );
              }
              if (PolygonSegment.isCubic(seg)) {
                const cubicSeg = seg as typeof seg & {
                  controlPointA: SheetPosition;
                  controlPointB: SheetPosition;
                };
                const newCubicSeg = newSeg as typeof seg & {
                  controlPointA: SheetPosition;
                  controlPointB: SheetPosition;
                };
                newCubicSeg.controlPointA = snapIfNotShifted(
                  new SheetPosition(cubicSeg.controlPointA.x + dx, cubicSeg.controlPointA.y + dy),
                );
                newCubicSeg.controlPointB = snapIfNotShifted(
                  new SheetPosition(cubicSeg.controlPointB.x + dx, cubicSeg.controlPointB.y + dy),
                );
              }
              return newSeg;
            });
            return PolygonComponent.update(polygon, { points: newPoints });
          },
        );
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const afterPolygon = this.getGeometryStore().polygons.find(
            (p) => p.id === this.draggingPolygonId,
          )!;
          const afterSegments = PolygonComponent.get(afterPolygon).points;
          const original = this.originalPolygonState.points;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().push(
              UndoEntry.polygonMove(this.draggingPolygonId, original, afterSegments),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            this.draggingPolygonId,
            PolygonComponent,
            (prev) => {
              return PolygonComponent.update(prev, {
                points: this.originalPolygonState!.points.slice(),
              });
            },
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Returns the pinned corner position for a given resize corner. */
  private getPinnedCorner(corner: ResizeCorner, bbox: Rect<SheetPosition>): SheetPosition {
    switch (corner) {
      case 'top-left':
        return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y + bbox.height);
      case 'top-right':
        return new SheetPosition(bbox.position.x, bbox.position.y + bbox.height);
      case 'bottom-left':
        return new SheetPosition(bbox.position.x + bbox.width, bbox.position.y);
      case 'bottom-right':
        return new SheetPosition(bbox.position.x, bbox.position.y);
    }
  }

  /** Returns the pinned edge position for a given resize edge. */
  private getPinnedEdge(
    edge: ResizeEdge,
    bbox: Rect<SheetPosition>,
  ): { pinnedX: boolean; pinnedY: boolean; pinnedPos: SheetPosition } {
    switch (edge) {
      case 'top':
        return {
          pinnedX: false,
          pinnedY: true,
          pinnedPos: new SheetPosition(bbox.position.x, bbox.position.y + bbox.height),
        };
      case 'bottom':
        return { pinnedX: false, pinnedY: true, pinnedPos: bbox.position };
      case 'left':
        return {
          pinnedX: true,
          pinnedY: false,
          pinnedPos: new SheetPosition(bbox.position.x + bbox.width, bbox.position.y),
        };
      case 'right':
        return { pinnedX: true, pinnedY: false, pinnedPos: bbox.position };
    }
  }

  /** Returns the center of a bounding box. */
  private getBoundingBoxCenter(bbox: Rect<SheetPosition>): SheetPosition {
    return new SheetPosition(bbox.position.x + bbox.width / 2, bbox.position.y + bbox.height / 2);
  }

  /** Scales a point from a pinned origin by given scale factors. */
  private scalePoint(
    point: SheetPosition,
    pin: SheetPosition,
    scaleX: number,
    scaleY: number,
  ): SheetPosition {
    const dx = point.x - pin.x;
    const dy = point.y - pin.y;
    return new SheetPosition(pin.x + dx * scaleX, pin.y + dy * scaleY);
  }

  /** Applies scaling to polygon points based on resize mode.
   *  @param polygonId - The polygon to scale
   *  @param newPos - The new position of the dragged handle in sheet coordinates
   *  @param superHeld - If true, uniform aspect ratio is preserved (min of scaleX, scaleY used for both)
   *  @param altHeld - If true, resize around center (both opposite corner/edge moves symmetrically) */
  private applyScaleToPolygon(
    polygonId: Id,
    newPos: SheetPosition,
    superHeld: boolean,
    altHeld: boolean,
  ): void {
    if (!this.resizeMode || !this.resizeOriginalBoundingBox || !this.resizeOriginalPoints) {
      return;
    }

    const polygon = this.getGeometryStore().polygons.find((p) => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const originalPoints = this.resizeOriginalPoints;
    const bbox = this.resizeOriginalBoundingBox;
    let pin: SheetPosition;
    let scaleX: number;
    let scaleY: number;

    if (altHeld) {
      pin = this.getBoundingBoxCenter(bbox);
    } else {
      pin =
        this.resizeMode.type === 'corner'
          ? this.getPinnedCorner(this.resizeMode.corner, bbox)
          : this.getPinnedEdge(this.resizeMode.edge, bbox).pinnedPos;
    }

    if (this.resizeMode.type === 'corner') {
      const corner = this.resizeMode.corner;
      let cornerX: number;
      let cornerY: number;
      if (corner === 'top-left') {
        cornerX = bbox.position.x;
        cornerY = bbox.position.y;
      } else if (corner === 'top-right') {
        cornerX = bbox.position.x + bbox.width;
        cornerY = bbox.position.y;
      } else if (corner === 'bottom-left') {
        cornerX = bbox.position.x;
        cornerY = bbox.position.y + bbox.height;
      } else {
        cornerX = bbox.position.x + bbox.width;
        cornerY = bbox.position.y + bbox.height;
      }

      if (altHeld) {
        scaleX = (newPos.x - pin.x) / (cornerX - pin.x);
        scaleY = (newPos.y - pin.y) / (cornerY - pin.y);
      } else {
        scaleX = (newPos.x - pin.x) / (cornerX - pin.x);
        scaleY = (newPos.y - pin.y) / (cornerY - pin.y);
      }
    } else {
      const edge = this.resizeMode.edge;
      if (edge === 'left' || edge === 'right') {
        if (altHeld) {
          scaleX = Math.abs(newPos.x - pin.x) / (bbox.width / 2);
          scaleY = 1;
        } else {
          scaleX = Math.abs(newPos.x - pin.x) / bbox.width;
          scaleY = 1;
        }
      } else {
        if (altHeld) {
          scaleX = 1;
          scaleY = Math.abs(newPos.y - pin.y) / (bbox.height / 2);
        } else {
          scaleX = 1;
          scaleY = Math.abs(newPos.y - pin.y) / bbox.height;
        }
      }
    }

    if (superHeld) {
      const minScale = Math.min(Math.abs(scaleX), Math.abs(scaleY));
      scaleX = Math.sign(scaleX) * minScale;
      scaleY = Math.sign(scaleY) * minScale;
    }

    this.getGeometryStore().updateByIdWithComponentDirect(polygonId, PolygonComponent, (prev) => {
      return PolygonComponent.update(prev, {
        points: originalPoints.map((seg) => {
          const newSeg: typeof seg = { ...seg };
          newSeg.point = this.scalePoint(seg.point, pin, scaleX, scaleY);
          if (PolygonSegment.isQuadratic(seg)) {
            (newSeg as typeof seg & { controlPoint: SheetPosition }).controlPoint = this.scalePoint(
              (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint,
              pin,
              scaleX,
              scaleY,
            );
          }
          if (PolygonSegment.isCubic(seg)) {
            const cubicSeg = seg as typeof seg & {
              controlPointA: SheetPosition;
              controlPointB: SheetPosition;
            };
            const newCubicSeg = newSeg as typeof seg & {
              controlPointA: SheetPosition;
              controlPointB: SheetPosition;
            };
            newCubicSeg.controlPointA = this.scalePoint(
              cubicSeg.controlPointA,
              pin,
              scaleX,
              scaleY,
            );
            newCubicSeg.controlPointB = this.scalePoint(
              cubicSeg.controlPointB,
              pin,
              scaleX,
              scaleY,
            );
          }
          return newSeg;
        }),
      });
    });
  }

  /** Starts resizing a polygon via a corner handle. */
  onCornerHandlePointerDown(
    viewportControls: ViewportControls,
    polygonId: Id,
    corner: ResizeCorner,
  ): void {
    const polygon = this.getGeometryStore().polygons.find((p) => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const cornerPolygonData = PolygonComponent.get(polygon);
    const originalPoints = cornerPolygonData.points.slice();
    const pointsArray = originalPoints.map((seg) => seg.point);
    const bbox = boundingBox(pointsArray);

    this.resizeMode = { type: 'corner', corner };
    this.resizeOriginalBoundingBox = bbox;
    this.resizeOriginalPoints = originalPoints;
    this.draggingPolygonId = polygonId;
    this.emit('dragStateChange', { type: 'polygon-corner', polygonId, corner });

    // Offset the initial mouse event, because if the user's drag starting on the offset bounding
    // box is assumed to be right at the ACTUAL bounding box border, there will be a sudden "jump"
    // where the actual bounding box will move to the outset bounding box location.
    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (corner) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const superHeld = this.toolManager.getSuperHeld();
        const altHeld = this.toolManager.getAltHeld();
        this.applyScaleToPolygon(this.draggingPolygonId, snapped, superHeld, altHeld);
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const afterPolygon = this.getGeometryStore().polygons.find(
            (p) => p.id === this.draggingPolygonId,
          )!;
          const afterSegments = PolygonComponent.get(afterPolygon).points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().push(
              UndoEntry.polygonMove(this.draggingPolygonId, original, afterSegments),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            this.draggingPolygonId,
            PolygonComponent,
            (prev) => {
              return PolygonComponent.update(prev, {
                points: this.resizeOriginalPoints!.slice(),
              });
            },
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts resizing a polygon via an edge (linear resizer). */
  onLinearResizerPointerDown(
    viewportControls: ViewportControls,
    polygonId: Id,
    edge: ResizeEdge,
  ): void {
    const polygon = this.getGeometryStore().polygons.find((p) => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const edgePolygonData = PolygonComponent.get(polygon);
    const originalPoints = edgePolygonData.points.slice();
    const pointsArray = originalPoints.map((seg) => seg.point);
    const bbox = boundingBox(pointsArray);

    this.resizeMode = { type: 'edge', edge };
    this.resizeOriginalBoundingBox = bbox;
    this.resizeOriginalPoints = originalPoints;
    this.draggingPolygonId = polygonId;
    this.emit('dragStateChange', { type: 'polygon-edge', polygonId, edge });

    // Offset the initial mouse event, because if the user's drag starting on the offset bounding
    // box is assumed to be right at the ACTUAL bounding box border, there will be a sudden "jump"
    // where the actual bounding box will move to the outset bounding box location.
    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (edge) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const superHeld = this.toolManager.getSuperHeld();
        const altHeld = this.toolManager.getAltHeld();
        this.applyScaleToPolygon(this.draggingPolygonId, snapped, superHeld, altHeld);
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const afterPolygon = this.getGeometryStore().polygons.find(
            (p) => p.id === this.draggingPolygonId,
          )!;
          const afterSegments = PolygonComponent.get(afterPolygon).points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().push(
              UndoEntry.polygonMove(this.draggingPolygonId, original, afterSegments),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            this.draggingPolygonId,
            PolygonComponent,
            (prev) => {
              return PolygonComponent.update(prev, {
                points: this.resizeOriginalPoints!.slice(),
              });
            },
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
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
    for (const id of this.getSelectionManager().getSelectedIds()) {
      this.getGeometryStore().deleteById(id);
    }
    this.getSelectionManager().clearSelection();
  }

  /** Adds a point on the specified line segment edge of a polygon at the given click position. */
  addPointOnLineSegmentEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    this.getGeometryStore().addPointOnLineSegmentEdge(polygonId, segmentIndex, sheetPos);
  }

  /** Adds a point on the specified quadratic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnQuadraticEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const polygon = this.getGeometryStore().getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const quadPolygonData = PolygonComponent.get(polygon);
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

    this.getGeometryStore().addPointOnQuadraticEdge(
      polygonId,
      segmentIndex,
      result.t,
      result.point,
    );
  }

  /** Adds a point on the specified cubic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnCubicEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const polygon = this.getGeometryStore().getByIdWithComponent(polygonId, PolygonComponent);
    if (!polygon) {
      return;
    }

    const cubicPolygonData = PolygonComponent.get(polygon);
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
    this.getGeometryStore().addPointOnCubicEdge(polygonId, segmentIndex, result.t, result.point);
  }

  // ==================== RECTANGLE HANDLERS ====================

  /** Called by the renderer when a rectangle fill is clicked in select mode. */
  handleRectangleSelect(rectangleId: Id, addToSelection: boolean): void {
    if (!addToSelection) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(rectangleId);
  }

  /** Starts dragging a rectangle fill (whole rectangle drag). */
  onRectangleFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    rectangleId: Id,
  ): void {
    const geometry = this.getGeometryStore().getById(rectangleId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        RectangleComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const rectangle = RectangleComponent.get(geometry);

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the rectangle, and start dragging the duplicate, not the
    // original
    let draggingRectangleId = rectangleId;
    if (this.toolManager.getAltHeld()) {
      let rectangleWithoutId: Partial<GeometryOmitComponents<Rectangle, RenderOrderComponent>> =
        RenderOrderComponent.remove({ ...geometry });
      delete rectangleWithoutId.id;
      draggingRectangleId = this.getGeometryStore().addRectangle(
        rectangleWithoutId as RectangleTemplate,
      ).id;
      this.getSelectionManager().deselect(rectangleId).select(draggingRectangleId);
    }

    this.computeShapeMoveTracks(draggingRectangleId, rectangle.upperLeft);

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    // NOTE: wait to emit the `dragStateChange` event until the mouse moves, because otherwise then
    // clicks will be seen as drags and clicking on polygons is also used for selecting.
    let initialDragStateChangeEmitted = false;

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!initialDragStateChangeEmitted) {
          this.emit('dragStateChange', { type: 'rectangle', rectangleId: draggingRectangleId });
          initialDragStateChangeEmitted = true;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const newSnapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const dx = newSnapped.x - snapped.x;
        const dy = newSnapped.y - snapped.y;

        if (!this.toolManager.getShiftHeld()) {
          const snappedUL = applySnappingOnConstrainedTrack(
            new SheetPosition(originalUpperLeft.x + dx, originalUpperLeft.y + dy),
            this.draggingConstrainedTrackResult,
            {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              shiftHeld: false,
              superHeld: false,
            },
          );
          const origWidth = originalLowerRight.x - originalUpperLeft.x;
          const origHeight = originalLowerRight.y - originalUpperLeft.y;
          const upperLeft = snappedUL;
          const lowerRight = new SheetPosition(snappedUL.x + origWidth, snappedUL.y + origHeight);
          this.getGeometryStore().updateByIdWithComponentDirect(
            draggingRectangleId,
            RectangleComponent,
            (old) => RectangleComponent.update(old, { upperLeft, lowerRight }),
          );
        } else {
          const snappedUL = applySnappingOnConstrainedTrack(
            new SheetPosition(originalUpperLeft.x + dx, originalUpperLeft.y + dy),
            this.draggingConstrainedTrackResult,
            {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              shiftHeld: true,
              superHeld: false,
            },
          );
          const upperLeft = snappedUL;
          const lowerRight = new SheetPosition(
            snappedUL.x + (originalLowerRight.x - originalUpperLeft.x),
            snappedUL.y + (originalLowerRight.y - originalUpperLeft.y),
          );
          this.getGeometryStore().updateByIdWithComponentDirect(
            draggingRectangleId,
            RectangleComponent,
            (old) => RectangleComponent.update(old, { upperLeft, lowerRight }),
          );
        }
      },
      onCommit: (_sp) => {
        const afterGeometry = this.getGeometryStore().getById(draggingRectangleId);
        if (
          afterGeometry &&
          Geometry.hasComponents(
            afterGeometry,
            RectangleComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          )
        ) {
          const afterRectangle = RectangleComponent.get(afterGeometry);
          if (
            originalUpperLeft.x !== afterRectangle.upperLeft.x ||
            originalUpperLeft.y !== afterRectangle.upperLeft.y
          ) {
            this.getHistoryManager().push(
              UndoEntry.rectangleMove(
                draggingRectangleId,
                RectangleComponent.create(originalUpperLeft, originalLowerRight).rectangle,
                RectangleComponent.get(afterGeometry),
              ),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(
          draggingRectangleId,
          RectangleComponent,
          {
            components: {
              ...RectangleComponent.create(originalUpperLeft, originalLowerRight),
              ...FillColorComponent.create(originalFillColor),
              ...RenderOrderComponent.create(originalRenderOrder),
              ...LinkDimensionsComponent.create(originalLinkDimensions),
            },
          },
        );
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts resizing a rectangle via a corner handle. */
  onRectangleCornerHandlePointerDown(
    viewportControls: ViewportControls,
    rectangleId: Id,
    corner: ResizeCorner,
  ): void {
    const geometry = this.getGeometryStore().getById(rectangleId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        RectangleComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const rectangle = RectangleComponent.get(geometry);

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    this.resizeMode = { type: 'corner', corner };
    this.draggingPolygonId = rectangleId;
    this.emit('dragStateChange', { type: 'rectangle-corner', rectangleId, corner });
    this.computeCornerResizeTracks(rectangleId, corner);

    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (corner) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
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
            shiftHeld: this.toolManager.getShiftHeld(),
            superHeld: false,
          },
        );

        const superHeld = this.toolManager.getSuperHeld();
        const altHeld = this.toolManager.getAltHeld();

        let newUpperLeft = originalUpperLeft;
        let newLowerRight = originalLowerRight;

        const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
        const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;

        if (altHeld) {
          let dx, dy;
          switch (corner) {
            case 'top-left':
              dx = centerX - snapped.x;
              dy = centerY - snapped.y;
              break;
            case 'top-right':
              dx = snapped.x - centerX;
              dy = centerY - snapped.y;
              break;
            case 'bottom-left':
              dx = centerX - snapped.x;
              dy = snapped.y - centerY;
              break;
            case 'bottom-right':
              dx = snapped.x - centerX;
              dy = snapped.y - centerY;
              break;
          }

          newUpperLeft = new SheetPosition(centerX - dx, centerY - dy);
          newLowerRight = new SheetPosition(centerX + dx, centerY + dy);
        } else {
          switch (corner) {
            case 'top-left':
              newUpperLeft = snapped;
              break;
            case 'top-right':
              newUpperLeft = new SheetPosition(originalUpperLeft.x, snapped.y);
              newLowerRight = new SheetPosition(snapped.x, originalLowerRight.y);
              break;
            case 'bottom-left':
              newUpperLeft = new SheetPosition(snapped.x, originalUpperLeft.y);
              newLowerRight = new SheetPosition(originalLowerRight.x, snapped.y);
              break;
            case 'bottom-right':
              newLowerRight = snapped;
              break;
          }
        }

        if (superHeld || LinkDimensionsComponent.get(geometry)) {
          const width = newLowerRight.x - newUpperLeft.x;
          const height = newLowerRight.y - newUpperLeft.y;
          const size = Math.max(Math.abs(width), Math.abs(height));
          const signX = width >= 0 ? 1 : -1;
          const signY = height >= 0 ? 1 : -1;
          const newWidth = signX * size;
          const newHeight = signY * size;
          if (altHeld) {
            newUpperLeft = new SheetPosition(centerX - newWidth / 2, centerY - newHeight / 2);
            newLowerRight = new SheetPosition(centerX + newWidth / 2, centerY + newHeight / 2);
          } else {
            switch (corner) {
              case 'top-left':
              case 'bottom-left':
                newUpperLeft = new SheetPosition(newLowerRight.x - size, newUpperLeft.y);
                break;
              case 'top-right':
              case 'bottom-right':
                newLowerRight = new SheetPosition(newUpperLeft.x + size, newLowerRight.y);
                break;
            }
            switch (corner) {
              case 'top-left':
              case 'top-right':
                newUpperLeft = new SheetPosition(newUpperLeft.x, newLowerRight.y - size);
                break;
              case 'bottom-left':
              case 'bottom-right':
                newLowerRight = new SheetPosition(newLowerRight.x, newUpperLeft.y + size);
                break;
            }
          }
        }

        const upperLeft = new SheetPosition(
          Math.min(newUpperLeft.x, newLowerRight.x),
          Math.min(newUpperLeft.y, newLowerRight.y),
        );
        const lowerRight = new SheetPosition(
          Math.max(newUpperLeft.x, newLowerRight.x),
          Math.max(newUpperLeft.y, newLowerRight.y),
        );

        // Make sure the user doesn't resize to be a 0-width / 0-height rectangle.
        if (upperLeft.x !== lowerRight.x && upperLeft.y !== lowerRight.y) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            rectangleId,
            RectangleComponent,
            (old) => {
              return RectangleComponent.update(old, { upperLeft, lowerRight });
            },
          );
        }
      },
      onCommit: (_sp) => {
        const afterRect = this.getGeometryStore().getByIdWithComponent(
          rectangleId,
          RectangleComponent,
        );
        if (afterRect) {
          this.getHistoryManager().push(
            UndoEntry.rectangleMove(
              rectangleId,
              RectangleComponent.create(originalUpperLeft, originalLowerRight).rectangle,
              RectangleComponent.get(afterRect),
            ),
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(rectangleId, RectangleComponent, {
          components: {
            ...RectangleComponent.create(originalUpperLeft, originalLowerRight),
            ...FillColorComponent.create(originalFillColor),
            ...RenderOrderComponent.create(originalRenderOrder),
            ...LinkDimensionsComponent.create(originalLinkDimensions),
          },
        });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts resizing a rectangle via an edge (linear resizer). */
  onRectangleEdgePointerDown(
    viewportControls: ViewportControls,
    rectangleId: Id,
    edge: ResizeEdge,
  ): void {
    const geometry = this.getGeometryStore().getById(rectangleId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        RectangleComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const rectangle = RectangleComponent.get(geometry);

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    this.resizeMode = { type: 'edge', edge };
    this.draggingPolygonId = rectangleId;
    this.emit('dragStateChange', { type: 'rectangle-edge', rectangleId, edge });

    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (edge) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const altHeld = this.toolManager.getAltHeld();

        let newUpperLeft = originalUpperLeft;
        let newLowerRight = originalLowerRight;
        const originalWidth = originalLowerRight.x - originalUpperLeft.x;
        const originalHeight = originalLowerRight.y - originalUpperLeft.y;

        if (altHeld) {
          const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
          const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
          const halfWidth = (originalLowerRight.x - originalUpperLeft.x) / 2;
          const halfHeight = (originalLowerRight.y - originalUpperLeft.y) / 2;
          const originalWidth = originalLowerRight.x - originalUpperLeft.x;
          const originalHeight = originalLowerRight.y - originalUpperLeft.y;

          switch (edge) {
            case 'top':
              newUpperLeft = new SheetPosition(centerX - halfWidth, snapped.y);
              newLowerRight = new SheetPosition(
                centerX + halfWidth,
                centerY + halfHeight + (originalUpperLeft.y - snapped.y),
              );
              if (LinkDimensionsComponent.get(geometry)) {
                const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
                const newWidth = originalWidth * (newHeight / originalHeight);
                newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
                newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
              }
              break;
            case 'bottom':
              newUpperLeft = new SheetPosition(
                centerX - halfWidth,
                centerY - halfHeight - (snapped.y - originalLowerRight.y),
              );
              newLowerRight = new SheetPosition(centerX + halfWidth, snapped.y);
              if (LinkDimensionsComponent.get(geometry)) {
                const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
                const newWidth = originalWidth * (newHeight / originalHeight);
                newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
                newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
              }
              break;
            case 'left':
              newUpperLeft = new SheetPosition(snapped.x, centerY - halfHeight);
              newLowerRight = new SheetPosition(
                centerX + halfWidth + (originalUpperLeft.x - snapped.x),
                centerY + halfHeight,
              );
              if (LinkDimensionsComponent.get(geometry)) {
                const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
                const newHeight = originalHeight * (newWidth / originalWidth);
                newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
                newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
              }
              break;
            case 'right':
              newUpperLeft = new SheetPosition(
                centerX - halfWidth - (snapped.x - originalLowerRight.x),
                centerY - halfHeight,
              );
              newLowerRight = new SheetPosition(snapped.x, centerY + halfHeight);
              if (LinkDimensionsComponent.get(geometry)) {
                const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
                const newHeight = originalHeight * (newWidth / originalWidth);
                newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
                newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
              }
              break;
          }
        } else {
          switch (edge) {
            case 'top':
              newUpperLeft = new SheetPosition(originalUpperLeft.x, snapped.y);
              if (LinkDimensionsComponent.get(geometry)) {
                const delta = originalUpperLeft.y - snapped.y;
                const newHeight = originalHeight + delta;
                const newWidth = originalWidth * (newHeight / originalHeight);
                const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
                newUpperLeft = new SheetPosition(centerX - newWidth / 2, snapped.y);
                newLowerRight = new SheetPosition(centerX + newWidth / 2, originalLowerRight.y);
              }
              break;
            case 'bottom':
              newLowerRight = new SheetPosition(originalLowerRight.x, snapped.y);
              if (LinkDimensionsComponent.get(geometry)) {
                const delta = snapped.y - originalLowerRight.y;
                const newHeight = originalHeight + delta;
                const newWidth = originalWidth * (newHeight / originalHeight);
                const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
                newUpperLeft = new SheetPosition(centerX - newWidth / 2, originalUpperLeft.y);
                newLowerRight = new SheetPosition(centerX + newWidth / 2, snapped.y);
              }
              break;
            case 'left':
              newUpperLeft = new SheetPosition(snapped.x, originalUpperLeft.y);
              if (LinkDimensionsComponent.get(geometry)) {
                const delta = originalUpperLeft.x - snapped.x;
                const newWidth = originalWidth + delta;
                const newHeight = originalHeight * (newWidth / originalWidth);
                const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
                newUpperLeft = new SheetPosition(snapped.x, centerY - newHeight / 2);
                newLowerRight = new SheetPosition(originalLowerRight.x, centerY + newHeight / 2);
              }
              break;
            case 'right':
              newLowerRight = new SheetPosition(snapped.x, originalLowerRight.y);
              if (LinkDimensionsComponent.get(geometry)) {
                const delta = snapped.x - originalLowerRight.x;
                const newWidth = originalWidth + delta;
                const newHeight = originalHeight * (newWidth / originalWidth);
                const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
                newUpperLeft = new SheetPosition(originalUpperLeft.x, centerY - newHeight / 2);
                newLowerRight = new SheetPosition(snapped.x, centerY + newHeight / 2);
              }
              break;
          }
        }

        const upperLeft = new SheetPosition(
          Math.min(newUpperLeft.x, newLowerRight.x),
          Math.min(newUpperLeft.y, newLowerRight.y),
        );
        const lowerRight = new SheetPosition(
          Math.max(newUpperLeft.x, newLowerRight.x),
          Math.max(newUpperLeft.y, newLowerRight.y),
        );

        // Make sure the user doesn't resize to be a 0-width / 0-height rectangle.
        if (upperLeft.x !== lowerRight.x && upperLeft.y !== lowerRight.y) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            rectangleId,
            RectangleComponent,
            (old) => RectangleComponent.update(old, { upperLeft, lowerRight }),
          );
        }
      },
      onCommit: (_sp) => {
        const afterRect = this.getGeometryStore().getByIdWithComponent(
          rectangleId,
          RectangleComponent,
        );
        if (afterRect) {
          this.getHistoryManager().push(
            UndoEntry.rectangleMove(
              rectangleId,
              RectangleComponent.create(originalUpperLeft, originalLowerRight).rectangle,
              RectangleComponent.get(afterRect),
            ),
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(rectangleId, RectangleComponent, {
          components: {
            ...RectangleComponent.create(originalUpperLeft, originalLowerRight),
            ...FillColorComponent.create(originalFillColor),
            ...RenderOrderComponent.create(originalRenderOrder),
            ...LinkDimensionsComponent.create(originalLinkDimensions),
          },
        });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  // ==================== ELLIPSE HANDLERS ====================

  /** Called by the renderer when an ellipse fill is clicked in select mode. */
  handleEllipseSelect(ellipseId: Id, addToSelection: boolean): void {
    if (!addToSelection) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(ellipseId);
  }

  /** Starts dragging an ellipse fill (whole ellipse drag). */
  onEllipseFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    ellipseId: Id,
  ): void {
    const geometry = this.getGeometryStore().getById(ellipseId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        EllipseComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const ellipseData = EllipseComponent.get(geometry);

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the ellipse, and start dragging the duplicate, not the
    // original
    let draggingEllipseId = ellipseId;
    if (this.toolManager.getAltHeld()) {
      let geometryWithoutId: Partial<GeometryOmitComponents<Ellipse, RenderOrderComponent>> =
        RenderOrderComponent.remove({ ...geometry });
      delete geometryWithoutId.id;
      draggingEllipseId = this.getGeometryStore().addEllipse(
        geometryWithoutId as EllipseTemplate,
      ).id;
      this.getSelectionManager().deselect(ellipseId).select(draggingEllipseId);
    }

    this.computeShapeMoveTracks(draggingEllipseId, ellipseData.center);

    const originalCenter = ellipseData.center;
    const originalRadiusX = ellipseData.radiusX;
    const originalRadiusY = ellipseData.radiusY;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    // NOTE: wait to emit the `dragStateChange` event until the mouse moves, because otherwise then
    // clicks will be seen as drags and clicking on polygons is also used for selecting.
    let initialDragStateChangeEmitted = false;

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        if (!initialDragStateChangeEmitted) {
          this.emit('dragStateChange', { type: 'ellipse', ellipseId: draggingEllipseId });
          initialDragStateChangeEmitted = true;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const newSnapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const dx = newSnapped.x - snapped.x;
        const dy = newSnapped.y - snapped.y;

        if (!this.toolManager.getShiftHeld()) {
          const snappedCenter = applySnappingOnConstrainedTrack(
            new SheetPosition(originalCenter.x + dx, originalCenter.y + dy),
            this.draggingConstrainedTrackResult,
            {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              shiftHeld: false,
              superHeld: false,
            },
          );
          this.getGeometryStore().updateByIdWithComponentDirect(
            draggingEllipseId,
            EllipseComponent,
            (old) => EllipseComponent.update(old, { center: snappedCenter }),
          );
        } else {
          const snappedCenter = applySnappingOnConstrainedTrack(
            new SheetPosition(originalCenter.x + dx, originalCenter.y + dy),
            this.draggingConstrainedTrackResult,
            {
              primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
              secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
              shiftHeld: true,
              superHeld: false,
            },
          );
          this.getGeometryStore().updateByIdWithComponentDirect(
            draggingEllipseId,
            EllipseComponent,
            (old) => EllipseComponent.update(old, { center: snappedCenter }),
          );
        }
      },
      onCommit: (_sp) => {
        const afterGeometry = this.getGeometryStore().getById(draggingEllipseId);
        if (
          afterGeometry &&
          Geometry.hasComponents(
            afterGeometry,
            EllipseComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          )
        ) {
          const afterEllipseData = EllipseComponent.get(afterGeometry);
          if (
            originalCenter.x !== afterEllipseData.center.x ||
            originalCenter.y !== afterEllipseData.center.y
          ) {
            this.getHistoryManager().push(
              UndoEntry.ellipseMove(
                draggingEllipseId,
                EllipseComponent.create(originalCenter, {
                  radiusX: originalRadiusX,
                  radiusY: originalRadiusY,
                }).ellipse,
                EllipseComponent.get(afterGeometry),
              ),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(draggingEllipseId, EllipseComponent, {
          components: {
            ...EllipseComponent.create(originalCenter, {
              radiusX: originalRadiusX,
              radiusY: originalRadiusY,
            }),
            ...FillColorComponent.create(originalFillColor),
            ...RenderOrderComponent.create(originalRenderOrder),
            ...LinkDimensionsComponent.create(originalLinkDimensions),
          },
        });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts resizing an ellipse via a corner handle. */
  onEllipseCornerHandlePointerDown(
    viewportControls: ViewportControls,
    ellipseId: Id,
    corner: ResizeCorner,
  ): void {
    const geometry = this.getGeometryStore().getById(ellipseId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        EllipseComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const ellipseData = EllipseComponent.get(geometry);

    const originalCenter = ellipseData.center;
    const originalRadiusX = ellipseData.radiusX;
    const originalRadiusY = ellipseData.radiusY;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    this.resizeMode = { type: 'corner', corner };
    this.draggingPolygonId = ellipseId;
    this.emit('dragStateChange', { type: 'ellipse-corner', ellipseId, corner });

    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (corner) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const superHeld = this.toolManager.getSuperHeld();
        const altHeld = this.toolManager.getAltHeld();

        let newCenter = originalCenter;
        let newRadiusX = originalRadiusX;
        let newRadiusY = originalRadiusY;

        if (altHeld) {
          let dx: number;
          let dy: number;
          switch (corner) {
            case 'top-left':
              dx = originalCenter.x - snapped.x;
              dy = originalCenter.y - snapped.y;
              break;
            case 'top-right':
              dx = snapped.x - originalCenter.x;
              dy = originalCenter.y - snapped.y;
              break;
            case 'bottom-left':
              dx = originalCenter.x - snapped.x;
              dy = snapped.y - originalCenter.y;
              break;
            case 'bottom-right':
              dx = snapped.x - originalCenter.x;
              dy = snapped.y - originalCenter.y;
              break;
          }
          newRadiusX = Math.abs(dx);
          newRadiusY = Math.abs(dy);
        } else {
          switch (corner) {
            case 'top-left': {
              const originalLowerRightX = originalCenter.x + originalRadiusX;
              const originalLowerRightY = originalCenter.y + originalRadiusY;
              newRadiusX = (originalLowerRightX - snapped.x) / 2 /* diameter -> radius */;
              newRadiusY = (originalLowerRightY - snapped.y) / 2 /* diameter -> radius */;
              newCenter = new SheetPosition(
                originalLowerRightX - newRadiusX,
                originalLowerRightY - newRadiusY,
              );
              break;
            }
            case 'top-right': {
              const originalBottomLeftX = originalCenter.x - originalRadiusX;
              const originalBottomLeftY = originalCenter.y + originalRadiusY;
              newRadiusX = (snapped.x - originalBottomLeftX) / 2 /* diameter -> radius */;
              newRadiusY = (originalBottomLeftY - snapped.y) / 2 /* diameter -> radius */;
              newCenter = new SheetPosition(
                originalBottomLeftX + newRadiusX,
                originalBottomLeftY - newRadiusY,
              );
              break;
            }
            case 'bottom-left': {
              const originalTopRightX = originalCenter.x + originalRadiusX;
              const originalTopRightY = originalCenter.y - originalRadiusY;
              newRadiusX = (originalTopRightX - snapped.x) / 2 /* diameter -> radius */;
              newRadiusY = (snapped.y - originalTopRightY) / 2 /* diameter -> radius */;
              newCenter = new SheetPosition(
                originalTopRightX - newRadiusX,
                originalTopRightY + newRadiusY,
              );
              break;
            }
            case 'bottom-right': {
              const originalTopLeftX = originalCenter.x - originalRadiusX;
              const originalTopLeftY = originalCenter.y - originalRadiusY;
              newRadiusX = (snapped.x - originalTopLeftX) / 2 /* diameter -> radius */;
              newRadiusY = (snapped.y - originalTopLeftY) / 2 /* diameter -> radius */;
              newCenter = new SheetPosition(
                originalTopLeftX + newRadiusX,
                originalTopLeftY + newRadiusY,
              );
              break;
            }
          }
        }

        if (superHeld || LinkDimensionsComponent.get(geometry)) {
          const dist = Math.max(newRadiusX, newRadiusY);
          const signX = newRadiusX >= 0 ? 1 : -1;
          const signY = newRadiusY >= 0 ? 1 : -1;
          const uniformRadiusX = signX * dist;
          const uniformRadiusY = signY * dist;
          if (altHeld) {
            newRadiusX = uniformRadiusX;
            newRadiusY = uniformRadiusY;
          } else {
            switch (corner) {
              case 'top-left':
                newCenter = new SheetPosition(
                  newCenter.x - (uniformRadiusX - newRadiusX),
                  newCenter.y - (uniformRadiusY - newRadiusY),
                );
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'top-right':
                newCenter = new SheetPosition(
                  newCenter.x + (uniformRadiusX - newRadiusX),
                  newCenter.y - (uniformRadiusY - newRadiusY),
                );
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'bottom-left':
                newCenter = new SheetPosition(
                  newCenter.x - (uniformRadiusX - newRadiusX),
                  newCenter.y + (uniformRadiusY - newRadiusY),
                );
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'bottom-right':
                newCenter = new SheetPosition(
                  newCenter.x + (uniformRadiusX - newRadiusX),
                  newCenter.y + (uniformRadiusY - newRadiusY),
                );
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
            }
          }
        }

        if (newRadiusX > 0 && newRadiusY > 0) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            ellipseId,
            EllipseComponent,
            (old) =>
              EllipseComponent.update(old, {
                center: newCenter,
                radiusX: newRadiusX,
                radiusY: newRadiusY,
              }),
          );
        }
      },
      onCommit: (_sp) => {
        const afterGeometry = this.getGeometryStore().getById(ellipseId);
        if (
          afterGeometry &&
          Geometry.hasComponents(
            afterGeometry,
            EllipseComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          )
        ) {
          this.getHistoryManager().push(
            UndoEntry.ellipseMove(
              ellipseId,
              EllipseComponent.create(originalCenter, {
                radiusX: originalRadiusX,
                radiusY: originalRadiusY,
              }).ellipse,
              EllipseComponent.get(afterGeometry),
            ),
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(ellipseId, EllipseComponent, {
          components: {
            ...EllipseComponent.create(originalCenter, {
              radiusX: originalRadiusX,
              radiusY: originalRadiusY,
            }),
            ...FillColorComponent.create(originalFillColor),
            ...RenderOrderComponent.create(originalRenderOrder),
            ...LinkDimensionsComponent.create(originalLinkDimensions),
          },
        });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts resizing an ellipse via an edge (linear resizer). */
  onEllipseEdgePointerDown(
    viewportControls: ViewportControls,
    ellipseId: Id,
    edge: ResizeEdge,
  ): void {
    const geometry = this.getGeometryStore().getById(ellipseId);
    if (
      !geometry ||
      !Geometry.hasComponents(
        geometry,
        EllipseComponent,
        FillColorComponent,
        LinkDimensionsComponent,
        RenderOrderComponent,
      )
    ) {
      return;
    }
    const ellipseData = EllipseComponent.get(geometry);

    const originalCenter = ellipseData.center;
    const originalRadiusX = ellipseData.radiusX;
    const originalRadiusY = ellipseData.radiusY;
    const originalFillColor = FillColorComponent.get(geometry);
    const originalRenderOrder = RenderOrderComponent.get(geometry);
    const originalLinkDimensions = LinkDimensionsComponent.get(geometry);

    this.resizeMode = { type: 'edge', edge };
    this.draggingPolygonId = ellipseId;
    this.emit('dragStateChange', { type: 'ellipse-edge', ellipseId, edge });

    let initialPointerDownOffsetXPx = 0;
    let initialPointerDownOffsetYPx = 0;
    switch (edge) {
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

    this.activeDragListener = createDragListener({
      initialPointerDownOffsetXPx,
      initialPointerDownOffsetYPx,
      viewportControls,
      onMove: (sp) => {
        if (!this.draggingPolygonId || !this.resizeMode) {
          return;
        }

        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const altHeld = this.toolManager.getAltHeld();

        let newCenterX = originalCenter.x;
        let newCenterY = originalCenter.y;
        let newRadiusX = originalRadiusX;
        let newRadiusY = originalRadiusY;

        if (altHeld) {
          switch (edge) {
            case 'top':
              newRadiusY = Math.abs(originalCenter.y - snapped.y);
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusX = originalRadiusX * (newRadiusY / newRadiusX);
              }
              break;
            case 'right':
              newRadiusX = Math.abs(snapped.x - originalCenter.x);
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusY = originalRadiusY * (newRadiusX / newRadiusY);
              }
              break;
            case 'left':
              newRadiusX = Math.abs(originalCenter.x - snapped.x);
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusY = originalRadiusY * (newRadiusX / newRadiusY);
              }
              break;
            case 'bottom':
              newRadiusY = Math.abs(snapped.y - originalCenter.y);
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusX = originalRadiusX * (newRadiusY / newRadiusX);
              }
              break;
          }
        } else {
          switch (edge) {
            case 'top': {
              const originalBottomY = originalCenter.y + originalRadiusY;
              newRadiusY = (originalBottomY - snapped.y) / 2 /* diameter -> radius */;
              newCenterY = originalBottomY - newRadiusY;
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusX = originalRadiusX * (newRadiusY / newRadiusX);
                // NOTE: don't offset radius, so that the resize propagates from the center middle
              }
              break;
            }
            case 'right': {
              const originalLeftX = originalCenter.x - originalRadiusX;
              newRadiusX = (snapped.x - originalLeftX) / 2 /* diameter -> radius */;
              newCenterX = originalLeftX + newRadiusX;
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusY = originalRadiusY * (newRadiusX / newRadiusY);
                // NOTE: don't offset radius, so that the resize propagates from the center middle
              }
              break;
            }
            case 'left': {
              const originalRightX = originalCenter.x + originalRadiusX;
              newRadiusX = (originalRightX - snapped.x) / 2 /* diameter -> radius */;
              newCenterX = originalRightX - newRadiusX;
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusY = originalRadiusY * (newRadiusX / newRadiusY);
                // NOTE: don't offset radius, so that the resize propagates from the center middle
              }
              break;
            }
            case 'bottom': {
              const originalTopY = originalCenter.y - originalRadiusY;
              newRadiusY = (snapped.y - originalTopY) / 2 /* diameter -> radius */;
              newCenterY = originalTopY + newRadiusY;
              if (LinkDimensionsComponent.get(geometry)) {
                newRadiusX = originalRadiusX * (newRadiusY / newRadiusX);
                // NOTE: don't offset radius, so that the resize propagates from the center middle
              }
              break;
            }
          }
        }

        if (newRadiusX > 0 && newRadiusY > 0) {
          this.getGeometryStore().updateByIdWithComponentDirect(
            ellipseId,
            EllipseComponent,
            (old) =>
              EllipseComponent.update(old, {
                center: new SheetPosition(newCenterX, newCenterY),
                radiusX: newRadiusX,
                radiusY: newRadiusY,
              }),
          );
        }
      },
      onCommit: (_sp) => {
        const afterGeometry = this.getGeometryStore().getById(ellipseId);
        if (
          afterGeometry &&
          Geometry.hasComponents(
            afterGeometry,
            EllipseComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          )
        ) {
          this.getHistoryManager().push(
            UndoEntry.ellipseMove(
              ellipseId,
              EllipseComponent.create(originalCenter, {
                radiusX: originalRadiusX,
                radiusY: originalRadiusY,
              }).ellipse,
              EllipseComponent.get(afterGeometry),
            ),
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateByIdWithComponentDirect(ellipseId, EllipseComponent, {
          components: {
            ...EllipseComponent.create(originalCenter, {
              radiusX: originalRadiusX,
              radiusY: originalRadiusY,
            }),
            ...FillColorComponent.create(originalFillColor),
            ...RenderOrderComponent.create(originalRenderOrder),
            ...LinkDimensionsComponent.create(originalLinkDimensions),
          },
        });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  onLinearConstraintEndpointPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    constraintId: Id,
    pointKey: 'pointA' | 'pointB',
  ): void {
    const constraint = this.getGeometryStore().getConstraintById(constraintId);
    if (!constraint) {
      return;
    }

    const sheetPos = screenPos.toWorld(viewportControls.getState().viewport).toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    const originalEndpoint = constraint[pointKey];
    const resolvedPos =
      this.getGeometryStore().resolveConstraintEndpoint(originalEndpoint) ?? snapped;
    const originalPointA = constraint.pointA;
    const originalPointB = constraint.pointB;

    // If the endpoint was locked to geometry, detach it by converting to a free-floating point.
    // This lets the user freely reposition it via drag.
    if (originalEndpoint.type !== 'point') {
      this.getGeometryStore().updateConstraintDirect(constraintId, (c) => ({
        ...c,
        [pointKey]: { type: 'point', point: resolvedPos },
      }));
    }

    const dragStartSheetPos = snapped;

    createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const gridSnapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const dx = gridSnapped.x - (dragStartSheetPos?.x ?? 0);
        const dy = gridSnapped.y - (dragStartSheetPos?.y ?? 0);
        const freePos = new SheetPosition(resolvedPos.x + dx, resolvedPos.y + dy);

        const snappedEndpoint = applyKeyPointSnapping(freePos, this.toolManager.getShiftHeld(), {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          superHeld: false,
          viewportScale: liveViewport.scale,
          rectangles: this.getGeometryStore().rectangles,
          ellipses: this.getGeometryStore().ellipses,
          polygons: this.getGeometryStore().polygons,
        });

        this.getGeometryStore().updateConstraintDirect(constraintId, (constraint) => ({
          ...constraint,
          [pointKey]: snappedEndpoint,
        }));

        if (snappedEndpoint.type !== 'point') {
          this.emit('keyPointSnapChange', { endpoint: snappedEndpoint, screenPosition: sp });
        } else {
          this.emit('keyPointSnapChange', null);
        }
      },
      onCommit: (_sp) => {
        let afterConstraint = this.getGeometryStore().getConstraintById(constraintId);
        if (afterConstraint) {
          const finalEndpoint = afterConstraint[pointKey];
          if (finalEndpoint.type === 'point') {
            const liveViewport = viewportControls.getState().viewport;
            const snappedEndpoint = applyKeyPointSnapping(
              finalEndpoint.point,
              this.toolManager.getShiftHeld(),
              {
                primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
                secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
                superHeld: false,
                viewportScale: liveViewport.scale,
                rectangles: this.getGeometryStore().rectangles,
                ellipses: this.getGeometryStore().ellipses,
                polygons: this.getGeometryStore().polygons,
              },
            );
            if (snappedEndpoint.type !== 'point') {
              this.getGeometryStore().updateConstraintDirect(constraintId, (c) => ({
                ...c,
                [pointKey]: snappedEndpoint,
              }));
              afterConstraint = this.getGeometryStore().getConstraintById(constraintId)!;
            }
          }

          this.emit('keyPointSnapChange', null);

          const changed = !ConstraintEndpoint.equal(originalEndpoint, afterConstraint[pointKey]);
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
        }
      },
      onCancel: () => {
        this.emit('keyPointSnapChange', null);
        const constraint = this.getGeometryStore().getConstraintById(constraintId);
        if (constraint) {
          this.getGeometryStore().updateConstraintDirect(constraintId, (c) => ({
            ...c,
            [pointKey]: originalEndpoint,
            pointA: originalPointA,
            pointB: originalPointB,
          }));
        }
      },
    });
  }

  onLinearConstraintLabelPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    constraintId: Id,
  ): void {
    const constraint = this.getGeometryStore().getConstraintById(constraintId);
    if (!constraint) {
      return;
    }

    this.constraintLabelPointerDownPosition = screenPos;
    const beforeValue = constraint.connectorLineOffsetPx;

    createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const sheetPos = sp.toWorld(liveViewport).toSheet();

        this.getGeometryStore().updateConstraintDirect(constraintId, (constraint) => {
          const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(constraint.pointA);
          const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(constraint.pointB);
          if (!resolvedA || !resolvedB) {
            return constraint;
          }

          const { point: closest } = closestPointOnSegment(resolvedA, resolvedB, sheetPos);

          const distPx = distance(sheetPos, closest) * SHEET_UNITS_TO_PIXELS * liveViewport.scale;

          const segDir = subVec2(resolvedB, resolvedA);
          const toQuery = subVec2(sheetPos, resolvedA);
          const cross = segDir.x * toQuery.y - segDir.y * toQuery.x;
          const sign = cross >= 0 ? 1 : -1;

          return {
            ...constraint,
            connectorLineOffsetPx: sign * distPx,
          };
        });
      },
      onCommit: (_sp) => {
        if (beforeValue) {
          const afterValue =
            this.getGeometryStore().getConstraintById(constraintId)?.connectorLineOffsetPx;
          if (beforeValue !== afterValue) {
            this.getHistoryManager().push(
              UndoEntry.linearConstraintMoveLabel(
                constraintId,
                beforeValue,
                afterValue ?? beforeValue,
              ),
            );
          }
        }
      },
      onCancel: () => {
        if (beforeValue) {
          this.getGeometryStore().updateConstraintDirect(constraintId, {
            connectorLineOffsetPx: beforeValue,
          });
        }
      },
    });
  }

  onLinearConstraintLabelPointerUp(
    screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    constraintId: Id,
    shiftKey: boolean,
  ): void {
    // Did the user drag their mouse while holding their mouse down?
    const didDragMouse =
      this.constraintLabelPointerDownPosition &&
      distance(this.constraintLabelPointerDownPosition, screenPos) > 0;

    const alreadySelected = this.getSelectionManager().isSelected(constraintId);
    if (alreadySelected && !didDragMouse) {
      // If selected, then allow the user to change the value
      const constraint = this.getGeometryStore().getConstraintById(constraintId);
      switch (constraint?.type) {
        case 'linear':
          this.getGeometryStore().setWorkingConstraints([
            {
              type: 'linear',
              pointA: constraint.pointA,
              pointB: constraint.pointB,
              constrainedLength: constraint.constrainedLength,
              connectorLineOffsetPx: -1 * constraint.connectorLineOffsetPx,
              disabled: false,

              // This hides `constraint` while this working constraint is visible.
              shadowsConstraintId: constraint.id,
            },
          ]);
          break;
      }
      return;
    }

    if (!shiftKey) {
      this.getSelectionManager().clearSelection();
    }
    this.getSelectionManager().toggle(constraintId);
  }
}
