import { ScreenPosition, SheetPosition, type ViewportState, type Rect } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { type Id, type Polygon, type Rectangle, type Ellipse, type PolygonSegment, type QuadraticBezierSegment, type CubicBezierSegment, type DraggingShapeState, type ResizeCorner, type ResizeEdge } from './types';
import { createDragListener, type DragListener } from '../drag/createDragListener';
import { BaseTool } from './BaseTool';
import { ViewportControls } from '../viewport/ViewportControls';
import { boundingBox, closestPointOnSegment, closestPointOnQuadraticCurve, closestPointOnCubicCurve } from '../math';
import { isPlatformControlKey } from '../detection';

export { ResizeCorner, ResizeEdge };

/** Events emitted by SelectTool. */
export type SelectToolEvents = {
  dragStateChange: (draggingShapeState: DraggingShapeState | null) => void;
  closestPointToSegmentChange: (closestPoint: { polygonId: Id; segmentIndex: number; point: SheetPosition } | null) => void;
};

/** Resize mode indicating which handle is being dragged. */
export type ResizeMode =
  | { type: 'corner'; corner: ResizeCorner }
  | { type: 'edge'; edge: ResizeEdge };

/** The pixels offset the selected bounded box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;

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

  /** Resize mode when resizing via bounding box handles. */
  private resizeMode: ResizeMode | null = null;
  /** Original bounding box at start of resize. */
  private resizeOriginalBoundingBox: Rect<SheetPosition> | null = null;
  /** Original polygon points at start of resize. */
  private resizeOriginalPoints: Array<PolygonSegment> | null = null;

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
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
    this.resizeMode = null;
    this.resizeOriginalBoundingBox = null;
    this.resizeOriginalPoints = null;
    this.emit('dragStateChange', null);
  }

  getCursor() {
    return 'default';
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
    return applySnapping(sheetPos, null, {
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
      this.getSelectionManager().clearSelection();
      return true;
    }

    // Backspace deletes a geometry
    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.deleteSelectedGeometry();
      return true;
    }

    // ctrl+a selects all geometry
    if (isPlatformControlKey(event) && event.key === 'a') {
      event.preventDefault();
      const ids = this.getGeometryStore().getAllGeometryIds();
      this.getSelectionManager().selectAll(ids);
      return true;
    }

    // ctrl+c copies to clipboard
    if (!this.getSelectionManager().isEmpty() && isPlatformControlKey(event) && event.key === 'c') {
      event.preventDefault();
      console.log('copy');
      const selectedText = this.getSerializationManager()?.formatSelectedAsFragment();
      if (typeof selectedText === 'string') {
        navigator.clipboard.writeText(selectedText);
        return true;
      }
    }
    // ctrl+v pastes to clipboard
    if (isPlatformControlKey(event) && event.key === 'v') {
      event.preventDefault();
      console.log('paste');
      navigator.clipboard.readText().then(text => {
        const result = this.getSerializationManager()?.loadFragment(text);
        console.log('RESULT', result);
      });
      return true;
    }

    return false;
  }

  /** Current closest point to segment for tooltip display. */
  private currentClosestPoint: { polygonId: Id; segmentIndex: number; point: SheetPosition } | null = null;

  /** Handles mouse move to compute closest point on selected polygon edges for tooltip. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const selectedIds = this.getSelectionManager().getSelectedIds();
    let newClosestPoint: { polygonId: Id; segmentIndex: number; point: SheetPosition } | null = null;
    let minDist = Infinity;

    for (const id of selectedIds) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (!polygon) continue;

      const pointCount = polygon.points.length;
      if (pointCount < 2) continue;

      // For closed polygons, we iterate all points (the last point connects back to the first).
      // For open polygons, we iterate up to the second-to-last point (the last point has no outgoing edge).
      const lastEdgeIndex = polygon.closed ? pointCount - 1 : pointCount - 2;

      for (let i = 0; i <= lastEdgeIndex; i++) {
        const currentSeg = polygon.points[i];
        const nextSegIndex = (i + 1) % pointCount;
        const nextSeg = polygon.points[nextSegIndex];

        let closest: SheetPosition;

        if (nextSeg.type === 'arc-quadratic') {
          // Quadratic curve: the curve goes from currentSeg.point to nextSeg.point with nextSeg.controlPoint
          const curve = {
            start: currentSeg.point,
            controlPoint: nextSeg.controlPoint,
            end: nextSeg.point,
          };
          closest = closestPointOnQuadraticCurve(curve, sheetPos).point;
        } else if (nextSeg.type === 'arc-cubic') {
          // Cubic curve: the curve goes from currentSeg.point to nextSeg.point with two control points
          const curve = {
            start: currentSeg.point,
            controlPointA: nextSeg.controlPointA,
            controlPointB: nextSeg.controlPointB,
            end: nextSeg.point,
          };
          closest = closestPointOnCubicCurve(curve, sheetPos).point;
        } else {
          // Line segment: from currentSeg.point to nextSeg.point
          closest = closestPointOnSegment(currentSeg.point, nextSeg.point, sheetPos).point;
        }

        const dx = closest.x - sheetPos.x;
        const dy = closest.y - sheetPos.y;
        const dist = dx * dx + dy * dy;

        if (dist < minDist) {
          minDist = dist;
          newClosestPoint = { polygonId: id, segmentIndex: i, point: closest };
        }
      }
    }

    if (newClosestPoint?.polygonId !== this.currentClosestPoint?.polygonId ||
        newClosestPoint?.segmentIndex !== this.currentClosestPoint?.segmentIndex ||
        newClosestPoint?.point.x !== this.currentClosestPoint?.point.x ||
        newClosestPoint?.point.y !== this.currentClosestPoint?.point.y) {
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
    const polygon = this.getGeometryStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const beforePoint = polygon.points[segmentIndex].point;

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = 'vertex';
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygon.points.slice() };

    this.lockedPoints = [{ polygonId, segmentIndex }];
    this.originalLockedPolygonStates.clear();
    this.originalLockedPolygonStates.set(polygonId, polygon.points.slice());

    const matchingPoints = this.getGeometryStore().findMatchingPoints(beforePoint, polygonId);
    for (const match of matchingPoints) {
      this.lockedPoints.push({ polygonId: match.polygonId, segmentIndex: match.segmentIndex });
      const otherPolygon = this.getGeometryStore().polygons.find(p => p.id === match.polygonId);
      if (otherPolygon) {
        this.originalLockedPolygonStates.set(match.polygonId, otherPolygon.points.slice());
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
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        this.getGeometryStore().updatePolygonDirect(this.draggingPolygonId, (prev) => {
          const points = prev.points.slice();
          const isFirstPointAndAtSamePositionAslastPoint = (
            this.draggingSegmentIndex === 0 &&
            points.at(-1)?.point.x === points[0].point.x &&
            points.at(-1)?.point.y === points[0].point.y
          );

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

          return { ...prev, points };
        });

        // Move points which are at the same position in the same way as the selected polygon.
        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }

          this.getGeometryStore().updatePolygon(locked.polygonId, (prev) => {
            const points = prev.points.slice();
            const isFirstPointAndAtSamePositionAsLastPoint = (
              locked.segmentIndex === 0 &&
              points.at(-1)?.point.x === points[0].point.x &&
              points.at(-1)?.point.y === points[0].point.y
            );

            points[locked.segmentIndex] = {
              ...points[locked.segmentIndex],
              point: snapped,
            };

            if (isFirstPointAndAtSamePositionAsLastPoint) {
              points[points.length - 1] = { ...points[points.length - 1], point: snapped };
            }

            return { ...prev, points };
          });
        }
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();

        if (this.draggingPolygonId && (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)) {
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

          const mainPolygon = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (mainPolygon && this.draggingSegmentIndex === 0) {
            const isFirstPointAndAtSamePositionAsLastPoint = (
              mainPolygon.points.at(-1)?.point.x === beforePoint.x &&
              mainPolygon.points.at(-1)?.point.y === beforePoint.y
            );
            if (isFirstPointAndAtSamePositionAsLastPoint) {
              moves.push({
                id: this.draggingPolygonId,
                segmentIndex: mainPolygon.points.length - 1,
                beforePoint,
                afterPoint,
              });
            }
          }

          for (const locked of this.lockedPoints) {
            if (locked.polygonId === this.draggingPolygonId) {
              continue;
            }

            const polygon = this.getGeometryStore().polygons.find(p => p.id === locked.polygonId);
            if (polygon && polygon.points[locked.segmentIndex].type === 'point') {
              const lockedBeforePoint = polygon.points[locked.segmentIndex].point;
              moves.push({
                id: locked.polygonId,
                segmentIndex: locked.segmentIndex,
                beforePoint: lockedBeforePoint,
                afterPoint,
              });

              if (locked.segmentIndex === 0) {
                const isFirstPointAndAtSamePositionAsLastPoint = (
                  polygon.points.at(-1)?.point.x === lockedBeforePoint.x &&
                  polygon.points.at(-1)?.point.y === lockedBeforePoint.y
                );
                if (isFirstPointAndAtSamePositionAsLastPoint) {
                  moves.push({
                    id: locked.polygonId,
                    segmentIndex: polygon.points.length - 1,
                    beforePoint: lockedBeforePoint,
                    afterPoint,
                  });
                }
              }
            }
          }

          if (moves.length > 1) {
            this.getHistoryManager().recordPolygonMoveMultipleVertices(moves);
          } else {
            this.getHistoryManager().recordPolygonMoveVertex(
              this.draggingPolygonId,
              this.draggingSegmentIndex,
              beforePoint,
              afterPoint,
            );
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          this.getGeometryStore().updatePolygon(this.draggingPolygonId, (prev) => ({
            ...prev,
            points: this.originalPolygonState!.points.slice(),
          }));
        }

        for (const locked of this.lockedPoints) {
          if (locked.polygonId === this.draggingPolygonId) {
            continue;
          }
          const originalState = this.originalLockedPolygonStates.get(locked.polygonId);
          if (originalState) {
            this.getGeometryStore().updatePolygonDirect(locked.polygonId, (prev) => ({
              ...prev,
              points: originalState.slice(),
            }));
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
    const polygon = this.getGeometryStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    let beforePoint: SheetPosition;
    if (pointKey === 'controlPoint') {
      beforePoint = (polygon.points[segmentIndex] as QuadraticBezierSegment).controlPoint;
    } else {
      beforePoint = (polygon.points[segmentIndex] as CubicBezierSegment)[pointKey];
    }

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = pointKey;
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygon.points.slice() };
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
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        this.getGeometryStore().updatePolygon(this.draggingPolygonId, (prev) => {
          const segments = prev.points.slice();
          if (this.draggingPointKey === 'controlPoint') {
            const seg = segments[this.draggingSegmentIndex] as QuadraticBezierSegment;
            segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snapped };
          } else {
            const seg = segments[this.draggingSegmentIndex] as CubicBezierSegment;
            segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snapped };
          }
          return { ...prev, points: segments };
        });
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();
        if (this.draggingPolygonId && (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)) {
          this.getHistoryManager().recordPolygonMoveControlPoint(
            this.draggingPolygonId,
            this.draggingSegmentIndex,
            pointKey,
            beforePoint,
            afterPoint,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const polygon = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.slice();
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts dragging a polygon fill (whole polygon drag). */
  onPolygonFillPointerDown(screenPos: ScreenPosition, viewportControls: ViewportControls, polygonId: Id): void {
    const polygon = this.getGeometryStore().getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the polygon, and start dragging the duplicate, not the
    // original
    if (this.toolManager.getAltHeld()) {
      let polygonWithoutId: Partial<Polygon> = { ...polygon };
      delete polygonWithoutId.id;
      this.draggingPolygonId = this.getGeometryStore().addPolygon(
        polygonWithoutId as Omit<Polygon, "id">
      ).id;
      this.getSelectionManager().deselect(polygon.id).select(this.draggingPolygonId);
    } else {
      this.draggingPolygonId = polygonId;
    }

    this.dragStartSheetPos = snapped;
    this.originalPolygonState = { points: polygon.points.slice() };

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
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        if (!this.draggingPolygonId) {
          return;
        }
        this.getGeometryStore().updatePolygonDirect(this.draggingPolygonId, (polygon) => {
          if (!this.originalPolygonState) {
            return polygon;
          }
          const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
          const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);
          return {
            ...polygon,
            points: this.originalPolygonState.points.map((seg) => {
              const newSeg: typeof seg = { ...seg };
              newSeg.point = new SheetPosition(seg.point.x + dx, seg.point.y + dy);
              if ('controlPoint' in seg) {
                (newSeg as typeof seg & { controlPoint: SheetPosition }).controlPoint = new SheetPosition(
                  (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint.x + dx,
                  (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint.y + dy,
                );
              }
              if ('controlPointA' in seg) {
                const cubicSeg = seg as typeof seg & { controlPointA: SheetPosition; controlPointB: SheetPosition };
                const newCubicSeg = newSeg as typeof seg & { controlPointA: SheetPosition; controlPointB: SheetPosition };
                newCubicSeg.controlPointA = new SheetPosition(cubicSeg.controlPointA.x + dx, cubicSeg.controlPointA.y + dy);
                newCubicSeg.controlPointB = new SheetPosition(cubicSeg.controlPointB.x + dx, cubicSeg.controlPointB.y + dy);
              }
              return newSeg;
            }),
          };
        });
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const afterSegments = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.originalPolygonState.points;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordPolygonMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const polygon = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.slice();
          }
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
  private getPinnedEdge(edge: ResizeEdge, bbox: Rect<SheetPosition>): { pinnedX: boolean; pinnedY: boolean; pinnedPos: SheetPosition } {
    switch (edge) {
      case 'top':
        return { pinnedX: false, pinnedY: true, pinnedPos: new SheetPosition(bbox.position.x, bbox.position.y + bbox.height) };
      case 'bottom':
        return { pinnedX: false, pinnedY: true, pinnedPos: bbox.position };
      case 'left':
        return { pinnedX: true, pinnedY: false, pinnedPos: new SheetPosition(bbox.position.x + bbox.width, bbox.position.y) };
      case 'right':
        return { pinnedX: true, pinnedY: false, pinnedPos: bbox.position };
    }
  }

  /** Returns the center of a bounding box. */
  private getBoundingBoxCenter(bbox: Rect<SheetPosition>): SheetPosition {
    return new SheetPosition(
      bbox.position.x + bbox.width / 2,
      bbox.position.y + bbox.height / 2,
    );
  }

  /** Scales a point from a pinned origin by given scale factors. */
  private scalePoint(point: SheetPosition, pin: SheetPosition, scaleX: number, scaleY: number): SheetPosition {
    const dx = point.x - pin.x;
    const dy = point.y - pin.y;
    return new SheetPosition(pin.x + dx * scaleX, pin.y + dy * scaleY);
  }

  /** Applies scaling to polygon points based on resize mode.
   *  @param polygonId - The polygon to scale
   *  @param newPos - The new position of the dragged handle in sheet coordinates
   *  @param superHeld - If true, uniform aspect ratio is preserved (min of scaleX, scaleY used for both)
   *  @param altHeld - If true, resize around center (both opposite corner/edge moves symmetrically) */
  private applyScaleToPolygon(polygonId: Id, newPos: SheetPosition, superHeld: boolean, altHeld: boolean): void {
    if (!this.resizeMode || !this.resizeOriginalBoundingBox || !this.resizeOriginalPoints) {
      return;
    }

    const polygon = this.getGeometryStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const bbox = this.resizeOriginalBoundingBox;
    let pin: SheetPosition;
    let scaleX: number;
    let scaleY: number;

    if (altHeld) {
      pin = this.getBoundingBoxCenter(bbox);
    } else {
      pin = this.resizeMode.type === 'corner'
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

    this.getGeometryStore().updatePolygonDirect(polygonId, {
      points: this.resizeOriginalPoints.map((seg) => {
        const newSeg: typeof seg = { ...seg };
        newSeg.point = this.scalePoint(seg.point, pin, scaleX, scaleY);
        if ('controlPoint' in seg) {
          (newSeg as typeof seg & { controlPoint: SheetPosition }).controlPoint = this.scalePoint(
            (seg as typeof seg & { controlPoint: SheetPosition }).controlPoint, pin, scaleX, scaleY
          );
        }
        if ('controlPointA' in seg) {
          const cubicSeg = seg as typeof seg & { controlPointA: SheetPosition; controlPointB: SheetPosition };
          const newCubicSeg = newSeg as typeof seg & { controlPointA: SheetPosition; controlPointB: SheetPosition };
          newCubicSeg.controlPointA = this.scalePoint(cubicSeg.controlPointA, pin, scaleX, scaleY);
          newCubicSeg.controlPointB = this.scalePoint(cubicSeg.controlPointB, pin, scaleX, scaleY);
        }
        return newSeg;
      }),
    });
  }

  /** Starts resizing a polygon via a corner handle. */
  onCornerHandlePointerDown(
    viewportControls: ViewportControls,
    polygonId: Id,
    corner: ResizeCorner,
  ): void {
    const polygon = this.getGeometryStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const originalPoints = polygon.points.slice();
    const pointsArray = originalPoints.map(seg => seg.point);
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
        const snapped = applySnapping(sheet, null, {
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
          const afterSegments = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordPolygonMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const polygon = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.resizeOriginalPoints.slice();
          }
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
    const polygon = this.getGeometryStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const originalPoints = polygon.points.slice();
    const pointsArray = originalPoints.map(seg => seg.point);
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
        const snapped = applySnapping(sheet, null, {
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
          const afterSegments = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordPolygonMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const polygon = this.getGeometryStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.resizeOriginalPoints.slice();
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Deletes all currently selected geometry (polygons, rectangles, ellipses), recording to history. */
  private deleteSelectedGeometry(): void {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getGeometryStore().deletePolygon(id);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().deleteRectangle(id);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().deleteEllipse(id);
        continue;
      }
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
    const polygon = this.getGeometryStore().getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];
    if (!pointSegment || !arcSegment || pointSegment.type !== 'point' || arcSegment.type !== 'arc-quadratic') {
      return;
    }

    const curve = {
      start: pointSegment.point,
      controlPoint: arcSegment.controlPoint,
      end: arcSegment.point,
    };

    const result = closestPointOnQuadraticCurve(curve, sheetPos);

    this.getGeometryStore().addPointOnQuadraticEdge(polygonId, segmentIndex, result.t, result.point);
  }

  /** Adds a point on the specified cubic arc edge of a polygon at the given click position.
   * The t parameter is computed from the sheet position. */
  addPointOnCubicEdge(polygonId: Id, segmentIndex: number, sheetPos: SheetPosition): void {
    const polygon = this.getGeometryStore().getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const pointSegment = polygon.points[segmentIndex];
    const arcSegment = polygon.points[segmentIndex + 1];
    if (!pointSegment || !arcSegment || pointSegment.type !== 'point' || arcSegment.type !== 'arc-cubic') {
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

  /** Applies snapping to a sheet position. */
  private applySnapping(pos: SheetPosition, prevPoint: SheetPosition | null): SheetPosition {
    return applySnapping(pos, prevPoint, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
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
  onRectangleFillPointerDown(screenPos: ScreenPosition, viewportControls: ViewportControls, rectangleId: Id): void {
    const rectangle = this.getGeometryStore().getRectangleById(rectangleId);
    if (!rectangle) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the rectangle, and start dragging the duplicate, not the
    // original
    let draggingRectangleId = rectangleId;
    if (this.toolManager.getAltHeld()) {
      let rectangleWithoutId: Partial<Rectangle> = { ...rectangle };
      delete rectangleWithoutId.id;
      draggingRectangleId = this.getGeometryStore().addRectangle(
        rectangleWithoutId as Omit<Rectangle, "id">
      ).id;
      this.getSelectionManager().deselect(rectangleId).select(draggingRectangleId);
    }

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = rectangle.fillColor;
    const originalLinkDimensions = rectangle.linkDimensions;

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
        const newSnapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const dx = newSnapped.x - snapped.x;
        const dy = newSnapped.y - snapped.y;

        this.getGeometryStore().updateRectangleDirect(draggingRectangleId, {
          upperLeft: new SheetPosition(originalUpperLeft.x + dx, originalUpperLeft.y + dy),
          lowerRight: new SheetPosition(originalLowerRight.x + dx, originalLowerRight.y + dy),
        });
      },
      onCommit: (_sp) => {
        const afterRect = this.getGeometryStore().getRectangleById(draggingRectangleId);
        if (afterRect && (originalUpperLeft.x !== afterRect.upperLeft.x || originalUpperLeft.y !== afterRect.upperLeft.y)) {
          this.getHistoryManager().recordRectangleMove(
            draggingRectangleId,
            { id: draggingRectangleId, upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterRect,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateRectangleDirect(draggingRectangleId, { upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
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
    const rectangle = this.getGeometryStore().getRectangleById(rectangleId);
    if (!rectangle) {
      return;
    }

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = rectangle.fillColor;
    const originalLinkDimensions = rectangle.linkDimensions;

    this.resizeMode = { type: 'corner', corner };
    this.draggingPolygonId = rectangleId;
    this.emit('dragStateChange', { type: 'rectangle-corner', rectangleId, corner });

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
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

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

        if (superHeld) {
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
          this.getGeometryStore().updateRectangleDirect(rectangleId, { upperLeft, lowerRight });
        }
      },
      onCommit: (_sp) => {
        const afterRect = this.getGeometryStore().getRectangleById(rectangleId);
        if (afterRect) {
          this.getHistoryManager().recordRectangleMove(
            rectangleId,
            { id: rectangleId, upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterRect,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateRectangleDirect(rectangleId, { upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
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
    const rectangle = this.getGeometryStore().getRectangleById(rectangleId);
    if (!rectangle) {
      return;
    }

    const originalUpperLeft = rectangle.upperLeft;
    const originalLowerRight = rectangle.lowerRight;
    const originalFillColor = rectangle.fillColor;
    const originalLinkDimensions = rectangle.linkDimensions;

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
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const altHeld = this.toolManager.getAltHeld();

        let newUpperLeft = originalUpperLeft;
        let newLowerRight = originalLowerRight;

        if (altHeld) {
          const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
          const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
          const halfWidth = (originalLowerRight.x - originalUpperLeft.x) / 2;
          const halfHeight = (originalLowerRight.y - originalUpperLeft.y) / 2;

          switch (edge) {
            case 'top':
              newUpperLeft = new SheetPosition(centerX - halfWidth, snapped.y);
              newLowerRight = new SheetPosition(
                centerX + halfWidth,
                centerY + halfHeight + (originalUpperLeft.y - snapped.y),
              );
              break;
            case 'bottom':
              newUpperLeft = new SheetPosition(
                centerX - halfWidth,
                centerY - halfHeight - (snapped.y - originalLowerRight.y),
              );
              newLowerRight = new SheetPosition(centerX + halfWidth, snapped.y);
              break;
            case 'left':
              newUpperLeft = new SheetPosition(snapped.x, centerY - halfHeight);
              newLowerRight = new SheetPosition(
                centerX + halfWidth + (originalUpperLeft.x - snapped.x),
                centerY + halfHeight,
              );
              break;
            case 'right':
              newUpperLeft = new SheetPosition(
                centerX - halfWidth - (snapped.x - originalLowerRight.x),
                centerY - halfHeight,
              );
              newLowerRight = new SheetPosition(snapped.x, centerY + halfHeight);
              break;
          }
        } else {
          switch (edge) {
            case 'top':
              newUpperLeft = new SheetPosition(originalUpperLeft.x, snapped.y);
              break;
            case 'bottom':
              newLowerRight = new SheetPosition(originalLowerRight.x, snapped.y);
              break;
            case 'left':
              newUpperLeft = new SheetPosition(snapped.x, originalUpperLeft.y);
              break;
            case 'right':
              newLowerRight = new SheetPosition(snapped.x, originalLowerRight.y);
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
          this.getGeometryStore().updateRectangleDirect(rectangleId, { upperLeft, lowerRight });
        }
      },
      onCommit: (_sp) => {
        const afterRect = this.getGeometryStore().getRectangleById(rectangleId);
        if (afterRect) {
          this.getHistoryManager().recordRectangleMove(
            rectangleId,
            { id: rectangleId, upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterRect,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateRectangle(rectangleId, { upperLeft: originalUpperLeft, lowerRight: originalLowerRight, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
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
  onEllipseFillPointerDown(screenPos: ScreenPosition, viewportControls: ViewportControls, ellipseId: Id): void {
    const ellipse = this.getGeometryStore().getEllipseById(ellipseId);
    if (!ellipse) {
      return;
    }

    const worldPos = screenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = applySnapping(sheetPos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });

    // If alt is held, then duplicate the ellipse, and start dragging the duplicate, not the
    // original
    let draggingEllipseId = ellipseId;
    if (this.toolManager.getAltHeld()) {
      let ellipseWithoutId: Partial<Ellipse> = { ...ellipse };
      delete ellipseWithoutId.id;
      draggingEllipseId = this.getGeometryStore().addEllipse(
        ellipseWithoutId as Omit<Ellipse, "id">
      ).id;
      this.getSelectionManager().deselect(ellipseId).select(draggingEllipseId);
    }

    const originalCenter = ellipse.center;
    const originalRadiusX = ellipse.radiusX;
    const originalRadiusY = ellipse.radiusY;
    const originalFillColor = ellipse.fillColor;
    const originalLinkDimensions = ellipse.linkDimensions;

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
        const newSnapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });

        const dx = newSnapped.x - snapped.x;
        const dy = newSnapped.y - snapped.y;

        this.getGeometryStore().updateEllipseDirect(draggingEllipseId, {
          center: new SheetPosition(originalCenter.x + dx, originalCenter.y + dy),
        });
      },
      onCommit: (_sp) => {
        const afterEllipse = this.getGeometryStore().getEllipseById(draggingEllipseId);
        if (afterEllipse && (originalCenter.x !== afterEllipse.center.x || originalCenter.y !== afterEllipse.center.y)) {
          this.getHistoryManager().recordEllipseMove(
            draggingEllipseId,
            { id: draggingEllipseId, center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterEllipse,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateEllipseDirect(draggingEllipseId, { center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
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
    const ellipse = this.getGeometryStore().getEllipseById(ellipseId);
    if (!ellipse) {
      return;
    }

    const originalCenter = ellipse.center;
    const originalRadiusX = ellipse.radiusX;
    const originalRadiusY = ellipse.radiusY;
    const originalFillColor = ellipse.fillColor;
    const originalLinkDimensions = ellipse.linkDimensions;

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
        const snapped = applySnapping(sheet, null, {
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

        if (superHeld) {
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
                newCenter = new SheetPosition(newCenter.x - (uniformRadiusX - newRadiusX), newCenter.y - (uniformRadiusY - newRadiusY));
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'top-right':
                newCenter = new SheetPosition(newCenter.x + (uniformRadiusX - newRadiusX), newCenter.y - (uniformRadiusY - newRadiusY));
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'bottom-left':
                newCenter = new SheetPosition(newCenter.x - (uniformRadiusX - newRadiusX), newCenter.y + (uniformRadiusY - newRadiusY));
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
              case 'bottom-right':
                newCenter = new SheetPosition(newCenter.x + (uniformRadiusX - newRadiusX), newCenter.y + (uniformRadiusY - newRadiusY));
                newRadiusX = uniformRadiusX;
                newRadiusY = uniformRadiusY;
                break;
            }
          }
        }

        if (newRadiusX > 0 && newRadiusY > 0) {
          this.getGeometryStore().updateEllipseDirect(ellipseId, { center: newCenter, radiusX: newRadiusX, radiusY: newRadiusY });
        }
      },
      onCommit: (_sp) => {
        const afterEllipse = this.getGeometryStore().getEllipseById(ellipseId);
        if (afterEllipse) {
          this.getHistoryManager().recordEllipseMove(
            ellipseId,
            { id: ellipseId, center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterEllipse,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateEllipseDirect(ellipseId, { center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
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
    const ellipse = this.getGeometryStore().getEllipseById(ellipseId);
    if (!ellipse) {
      return;
    }

    const originalCenter = ellipse.center;
    const originalRadiusX = ellipse.radiusX;
    const originalRadiusY = ellipse.radiusY;
    const originalFillColor = ellipse.fillColor;
    const originalLinkDimensions = ellipse.linkDimensions;

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
        const snapped = applySnapping(sheet, null, {
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
              break;
            case 'right':
              newRadiusX = Math.abs(snapped.x - originalCenter.x);
              break;
            case 'left':
              newRadiusX = Math.abs(originalCenter.x - snapped.x);
              break;
            case 'bottom':
              newRadiusY = Math.abs(snapped.y - originalCenter.y);
              break;
          }
        } else {
          switch (edge) {
            case 'top': {
              const originalBottomY = originalCenter.y + originalRadiusY;
              newRadiusY = (originalBottomY - snapped.y) / 2 /* diameter -> radius */;
              newCenterY = originalBottomY - newRadiusY;
              break;
            }
            case 'right': {
              const originalLeftX = originalCenter.x - originalRadiusX;
              newRadiusX = (snapped.x - originalLeftX) / 2 /* diameter -> radius */;
              newCenterX = originalLeftX + newRadiusX;
              break;
            }
            case 'left': {
              const originalRightX = originalCenter.x + originalRadiusX;
              newRadiusX = (originalRightX - snapped.x) / 2 /* diameter -> radius */;
              newCenterX = originalRightX - newRadiusX;
              break;
            }
            case 'bottom': {
              const originalTopY = originalCenter.y - originalRadiusY;
              newRadiusY = (snapped.y - originalTopY) / 2 /* diameter -> radius */;
              newCenterY = originalTopY + newRadiusY;
              break;
            }
          }
        }

        if (newRadiusX > 0 && newRadiusY > 0) {
          this.getGeometryStore().updateEllipseDirect(ellipseId, {
            center: new SheetPosition(newCenterX, newCenterY),
            radiusX: newRadiusX,
            radiusY: newRadiusY,
          });
        }
      },
      onCommit: (_sp) => {
        const afterEllipse = this.getGeometryStore().getEllipseById(ellipseId);
        if (afterEllipse) {
          this.getHistoryManager().recordEllipseMove(
            ellipseId,
            { id: ellipseId, center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions },
            afterEllipse,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        this.getGeometryStore().updateEllipseDirect(ellipseId, { center: originalCenter, radiusX: originalRadiusX, radiusY: originalRadiusY, fillColor: originalFillColor, linkDimensions: originalLinkDimensions });
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }
}
