import { MousePointer2Icon } from 'lucide-react';
import { type DragListener, createDragListener } from '@/lib/drag/create-drag-listener';
import {
  Constraint,
  type CubicBezierSegment,
  type Ellipse,
  EllipseComponent,
  FillColorComponent,
  Geometry,
  GeometryOmitComponents,
  type Id,
  LayoutState,
  LinkDimensionsComponent,
  type Polygon,
  PolygonComponent,
  PolygonSegment,
  type QuadraticBezierSegment,
  type Rectangle,
  RectangleComponent,
  type RectangleEndpoint,
  RenderOrderComponent,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeMode,
  type ResizeParams,
} from '@/lib/geometry';
import { ID_PREFIXES, getPrefixFromId } from '@/lib/geometry/GeometryStore';
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
import { boundingBoxContains } from '../math/bounding-box';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import { ViewportControls } from '../viewport/ViewportControls';
import { Rect, ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { type DraggingShapeState } from './types';

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
  dragSelectBoundingBoxChange: (bounds: Rect<SheetPosition> | null) => void;
};

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

  private originalDragState = new Map<Id, ReturnType<typeof Geometry.getLayoutState>>();
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
  private resizeOriginalGroupStates: Map<Id, LayoutState> | null = null;
  /** Original union bounding box at start of resize. */
  private resizeOriginalUnionBBox: Rect<SheetPosition> | null = null;

  /** The initial position the user clicked when clicking on a constraint label. Used to determine
   * if the user just clicked, or clicked and dragged (which moves the label). */
  private constraintLabelPointerDownPosition: ScreenPosition | null = null;

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
    this.emit('hoveringPolygonSegmentChange', false);
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
          this.dragSelectBoundingBox = boundingBox([
            this.dragSelectStartSheetPos!,
            endSheetPosition,
          ]) as Rect<SheetPosition>;
        }

        const selectedIds = new Set<Geometry['id']>();
        for (const geometry of this.getGeometryStore().listWithComponent(RenderOrderComponent)) {
          const bbox = Geometry.boundingBox(geometry);
          if (boundingBoxContains(this.dragSelectBoundingBox, bbox)) {
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
  onEnterGeometryFill(_id: Id): void {
    this.scheduleTooltip('geometry-fill', GEOMETRY_FILL_TOOLTIP_TIMEOUT_MS);
  }

  /** Called by the renderer when the pointer leaves the fill area of a shape. */
  onLeaveGeometryFill(_id: Id): void {
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
      const polygon = this.getGeometryStore().getByIdWithComponent(id, PolygonComponent);
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

  /** Starts dragging a vertex handle. Called from renderer pointer down on vertex handles. */
  onVertexPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    polygonId: Id,
    segmentIndex: number,
  ) {
    const polygon = this.getGeometryStore().getByIdWithComponent(polygonId, PolygonComponent);
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
      const otherPolygon = this.getGeometryStore().getByIdWithComponent(
        match.polygonId,
        PolygonComponent,
      );
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

          const mainPolygon = this.getGeometryStore().getByIdWithComponent(
            this.draggingPolygonId,
            PolygonComponent,
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

            const polygon = this.getGeometryStore().getByIdWithComponent(
              locked.polygonId,
              PolygonComponent,
            );
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
    const polygon = this.getGeometryStore().getByIdWithComponent(polygonId, PolygonComponent);
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
    excludeConstraintsAttachedToGeometryIds: Array<Geometry['id']> = [],
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

        // If a constraint is attached to an excluded endpoint, then it shouldn't take effect
        //
        // Example case where this is used: three geometries are all selected and are being moved
        // together with constraints all internally between them all.
        const excluded = (ep: ConstraintEndpoint): boolean =>
          (ep.type === 'locked-rectangle' ||
            ep.type === 'locked-ellipse' ||
            ep.type === 'locked-polygon') &&
          excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        if (excluded(c.pointA) || excluded(c.pointB)) {
          return null;
        }

        const attached = (ep: ConstraintEndpoint): boolean =>
          (ep.type === 'locked-rectangle' ||
            ep.type === 'locked-ellipse' ||
            ep.type === 'locked-polygon') &&
          ep.id === geometryId &&
          !excludeConstraintsAttachedToGeometryIds.includes(ep.id);

        const aAttached = attached(c.pointA);
        const bAttached = attached(c.pointB);

        // Skip if both or neither are attached - no single moving endpoint
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

  // ==================== COMMON GEOMETEY  HANDLERS ====================

  onGeometryFillPointerDown(
    screenPos: ScreenPosition,
    viewportControls: ViewportControls,
    geometryId: Id,
  ): void {
    const shiftHeld = this.toolManager.getShiftHeld();
    const altHeld = this.toolManager.getAltHeld();

    // Select / deselect the clicked geometry
    if (!this.getSelectionManager().isSelected(geometryId)) {
      if (this.getSelectionManager().isEmpty() || shiftHeld) {
        this.getSelectionManager().select(geometryId);
      } else {
        this.getSelectionManager().clearSelection().select(geometryId);
      }
    } else if (shiftHeld) {
      this.getSelectionManager().deselect(geometryId);
    }

    // If selected, then translate all selected geometries
    const selectedIds = this.getSelectionManager().getSelectedIds();

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld,
      superHeld: false,
    });

    this.dragStartSheetPos = snapped;

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
          GeometryOmitComponents<typeof geometry, RenderOrderComponent>
        > = RenderOrderComponent.remove({ ...geometry });
        delete geometryWithoutId.id;
        const geometryIdPrefix = getPrefixFromId(geometry.id);
        if (!geometryIdPrefix) {
          throw new Error(
            `SelectTool.onGeometryFillPointerDown: no prefix '${geometryIdPrefix}' is known!`,
          );
        }
        const duplicateGeometry = this.getGeometryStore().add(
          geometryIdPrefix,
          geometryWithoutId as Required<typeof geometryWithoutId>,
          { direct: true },
        );
        draggingIds.push(duplicateGeometry.id);
        this.originalDragState.set(
          duplicateGeometry.id,
          Geometry.getLayoutState(duplicateGeometry),
        );
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
          return [[id, Geometry.getLayoutState(geom)]];
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
            this.getSelectionManager().select(geometryId);
            const geom = this.getGeometryStore().getById(geometryId);
            if (geom) {
              this.originalDragState.set(geometryId, Geometry.getLayoutState(geom));
              draggingIds.push(geometryId);

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
            shiftHeld: this.toolManager.getShiftHeld(),
            superHeld: false,
          },
        );

        for (const [id, state] of this.originalDragState) {
          this.getGeometryStore().updateByIdDirect(id, (geometry) => {
            if (!state) {
              return geometry;
            }
            const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
            const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);
            const newState = LayoutState.translate(state, (oldPoint) => {
              const newPoint = new SheetPosition(oldPoint.x + dx, oldPoint.y + dy);
              if (this.toolManager.getShiftHeld()) {
                return newPoint;
              }
              return snapToNearestGrid(
                newPoint,
                this.toolManager.snappingOptions.primaryGridSize,
                this.toolManager.snappingOptions.secondaryGridSize,
              );
            });
            return Geometry.setLayoutState(geometry, newState);
          });
        }
      },
      onCommit: (_sp) => {
        const forwardsActions: Array<UndoEntry> = [];
        for (const [id, state] of this.originalDragState) {
          if (!state) {
            continue;
          }
          const geometry = this.getGeometryStore().getById(id);
          if (!geometry) {
            continue;
          }
          const newState = Geometry.getLayoutState(geometry);
          if (!newState) {
            continue;
          }

          // Newly added geometies via alt+drag must be officially logged as created
          if (duplicated) {
            forwardsActions.push(UndoEntry.insert(geometry));
          }

          // And also log any position changes
          if (!LayoutState.equals(state, newState)) {
            // FIXME: replace with one single event
            if (state.for === 'polygon' && Geometry.hasComponent(geometry, PolygonComponent)) {
              forwardsActions.push(
                UndoEntry.polygonMove(id, state.points, PolygonComponent.get(geometry).points),
              );
            } else if (
              state.for === 'ellipse' &&
              Geometry.hasComponent(geometry, EllipseComponent)
            ) {
              forwardsActions.push(
                UndoEntry.ellipseMove(
                  id,
                  EllipseComponent.create(state.center, {
                    radiusX: state.radiusX,
                    radiusY: state.radiusY,
                  }).ellipse,
                  EllipseComponent.get(geometry),
                ),
              );
            } else if (
              state.for === 'rectangle' &&
              Geometry.hasComponent(geometry, RectangleComponent)
            ) {
              forwardsActions.push(
                UndoEntry.rectangleMove(
                  id,
                  RectangleComponent.create(state.upperLeft, state.lowerRight).rectangle,
                  RectangleComponent.get(geometry),
                ),
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
            this.getGeometryStore().updateByIdDirect(id, (old) =>
              Geometry.setLayoutState(old, state),
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
  }

  /** Starts resizing one or more geometries via a corner or edge handle of the bounding box. */
  onGeometryResizePointerDown(
    viewportControls: ViewportControls,
    geometryIds: Array<Id>,
    resizeMode: ResizeMode,
  ): void {
    // Capture original layout states for all geometries
    const originalStates = new Map<Id, LayoutState>();
    for (const id of geometryIds) {
      const geometry = this.getGeometryStore().getById(id);
      if (!geometry) {
        continue;
      }
      const state = Geometry.getLayoutState(geometry);
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
      let bbox: Rect<SheetPosition>;
      switch (state.for) {
        case 'rectangle':
          bbox = {
            position: state.upperLeft,
            width: state.lowerRight.x - state.upperLeft.x,
            height: state.lowerRight.y - state.upperLeft.y,
          };
          break;
        case 'ellipse':
          bbox = {
            position: new SheetPosition(
              state.center.x - state.radiusX,
              state.center.y - state.radiusY,
            ),
            width: state.radiusX * 2,
            height: state.radiusY * 2,
          };
          break;
        case 'polygon': {
          const pointsArray = state.points.map((seg) => seg.point);
          bbox = boundingBox(pointsArray);
          break;
        }
        default:
          state satisfies never;
          continue;
      }

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
      if (geometry && Geometry.hasComponent(geometry, LinkDimensionsComponent)) {
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
        const snapped = applySnapping(sheet, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const altHeld = this.toolManager.getAltHeld();
        const superHeld = this.toolManager.getSuperHeld();

        const params: ResizeParams = {
          to: snapped,
          mode: this.resizeMode,
          altHeld,
          superHeld,
          linkDimensions,
        };

        // Compute new union bounding box
        const newUnionBBox = LayoutState.resizeBBox(unionBBox, params);
        if (!newUnionBBox) {
          return;
        }

        // Apply percentage-based resize to each geometry
        for (const [id, originalState] of groupStates) {
          const newState = LayoutState.resize(originalState, params, unionBBox);
          if (newState) {
            this.getGeometryStore().updateByIdDirect(id, (old) =>
              Geometry.setLayoutState(old, newState),
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
              const afterState = Geometry.getLayoutState(afterGeometry);
              if (!afterState || LayoutState.equals(originalState, afterState)) {
                continue;
              }

              if (
                originalState.for === 'polygon' &&
                Geometry.hasComponent(afterGeometry, PolygonComponent)
              ) {
                this.getHistoryManager().push(
                  UndoEntry.polygonMove(
                    id,
                    originalState.points,
                    PolygonComponent.get(afterGeometry).points,
                  ),
                );
              } else if (
                originalState.for === 'ellipse' &&
                Geometry.hasComponent(afterGeometry, EllipseComponent)
              ) {
                this.getHistoryManager().push(
                  UndoEntry.ellipseMove(
                    id,
                    EllipseComponent.create(originalState.center, {
                      radiusX: originalState.radiusX,
                      radiusY: originalState.radiusY,
                    }).ellipse,
                    EllipseComponent.get(afterGeometry),
                  ),
                );
              } else if (
                originalState.for === 'rectangle' &&
                Geometry.hasComponent(afterGeometry, RectangleComponent)
              ) {
                this.getHistoryManager().push(
                  UndoEntry.rectangleMove(
                    id,
                    RectangleComponent.create(originalState.upperLeft, originalState.lowerRight)
                      .rectangle,
                    RectangleComponent.get(afterGeometry),
                  ),
                );
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
              Geometry.setLayoutState(old, originalState),
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /**
   * Computes constrained tracks for a rectangle corner resize.
   * Only handles constraints on the dragged corner (offset = 0 — track applies directly to
   * the snapped cursor position). Constraints on adjacent or opposite corners are skipped.
   *
   * Sets `draggingConstrainedTrackResult` as appropriate.
   */
  private computeCornerResizeTracks(geometryId: Id, corner: ResizeCorner): ConstrainedTrackPath {
    const sheetConfig = this.getSheet();
    if (!sheetConfig) {
      return 'unconstrained';
    }

    const matchedConstraints = this.getGeometryStore().findConstraintsByGeometryId(geometryId);
    if (matchedConstraints.length === 0) {
      return 'unconstrained';
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
      return 'unconstrained';
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
        const intersection = ConstrainedTrack.intersectTracks(existing, tracks[i]);
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

  // ==================== CONSTRAINT HANDLERS ====================

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
          rectangles: this.getGeometryStore().listWithComponents(
            RectangleComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          ),
          ellipses: this.getGeometryStore().listWithComponents(
            EllipseComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          ),
          polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
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
                rectangles: this.getGeometryStore().listWithComponents(
                  RectangleComponent,
                  FillColorComponent,
                  LinkDimensionsComponent,
                  RenderOrderComponent,
                ),
                ellipses: this.getGeometryStore().listWithComponents(
                  EllipseComponent,
                  FillColorComponent,
                  LinkDimensionsComponent,
                  RenderOrderComponent,
                ),
                polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
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
