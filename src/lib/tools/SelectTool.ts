import { ScreenPosition, SheetPosition, type ViewportState, type Rect } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { type Id, type PolygonSegment, type QuadraticBezierSegment, type CubicBezierSegment } from './types';
import { createDragListener, type DragListener } from '../drag/createDragListener';
import { BaseTool } from './BaseTool';
import { ViewportControls } from '../viewport/ViewportControls';
import { boundingBox } from '../math';

/** Events emitted by SelectTool. */
export type SelectToolEvents = {
  dragStateChange: (draggingPolygonId: Id | null) => void;
};

/** Corner being dragged during polygon resize. */
export type ResizeCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Edge being dragged during polygon resize. */
export type ResizeEdge = 'top' | 'bottom' | 'left' | 'right';

/** Resize mode indicating which handle is being dragged. */
export type ResizeMode =
  | { type: 'corner'; corner: ResizeCorner }
  | { type: 'edge'; edge: ResizeEdge };

/** The pixels offset the selected bounded box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;

/** A tool for selecting / manipulating polygons. */
export class SelectTool extends BaseTool<SelectToolEvents> {
  type = 'select' as const;

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
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (this.activeDragListener) {
        this.cancelActiveDrag();
        return;
      }
      this.getSelectionManager().clearSelection();
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      this.deleteSelectedPolygons();
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
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
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
    this.originalPolygonState = { points: polygon.points.map(seg => ({ ...seg })) };
    this.emit('dragStateChange', polygonId);

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

        this.getPolygonStore().updatePolygon(this.draggingPolygonId, (prev) => {
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
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();
        if (this.draggingPolygonId && (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)) {
          this.getHistoryManager().recordMoveVertex(
            this.draggingPolygonId,
            this.draggingSegmentIndex,
            beforePoint,
            afterPoint,
          );
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.map(seg => ({ ...seg }));
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
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
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
    this.originalPolygonState = { points: polygon.points.map(seg => ({ ...seg })) };
    this.emit('dragStateChange', polygonId);

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });
        const segments = [...this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId)!.points];
        if (this.draggingPointKey === 'controlPoint') {
          const seg = segments[this.draggingSegmentIndex] as QuadraticBezierSegment;
          segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snapped };
        } else {
          const seg = segments[this.draggingSegmentIndex] as CubicBezierSegment;
          segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snapped };
        }
        this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId)!.points = segments;
      },
      onCommit: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();
        if (this.draggingPolygonId && (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)) {
          this.getHistoryManager().recordMoveControlPoint(
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
          const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.map(seg => ({ ...seg }));
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Starts dragging a polygon fill (whole polygon drag). */
  onPolygonFillPointerDown(screenPos: ScreenPosition, viewportControls: ViewportControls, polygonId: Id): void {
    const polygon = this.getPolygonStore().getPolygonById(polygonId);
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
    this.draggingPolygonId = polygonId;
    this.dragStartSheetPos = snapped;
    this.originalPolygonState = { points: polygon.points.map(seg => ({ ...seg })) };
    this.emit('dragStateChange', polygonId);

    this.activeDragListener = createDragListener({
      viewportControls,
      onMove: (sp) => {
        const liveViewport = viewportControls.getState().viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.toolManager.getShiftHeld(),
          superHeld: false,
        });
        const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
        if (!polygon || !this.originalPolygonState) return;
        const dx = snapped.x - (this.dragStartSheetPos?.x ?? 0);
        const dy = snapped.y - (this.dragStartSheetPos?.y ?? 0);
        polygon.points = this.originalPolygonState.points.map((seg) => {
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
        });
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const afterSegments = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.originalPolygonState.points;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.map(seg => ({ ...seg }));
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Returns the opposite corner for a given corner. */
  private getOppositeCorner(corner: ResizeCorner): { x: number; y: number } {
    switch (corner) {
      case 'top-left': return { x: 1, y: 1 };
      case 'top-right': return { x: -1, y: 1 };
      case 'bottom-left': return { x: 1, y: -1 };
      case 'bottom-right': return { x: -1, y: -1 };
    }
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

  /** Scales a point from a pinned origin by given scale factors. */
  private scalePoint(point: SheetPosition, pin: SheetPosition, scaleX: number, scaleY: number): SheetPosition {
    const dx = point.x - pin.x;
    const dy = point.y - pin.y;
    return new SheetPosition(pin.x + dx * scaleX, pin.y + dy * scaleY);
  }

  /** Applies scaling to polygon points based on resize mode. */
  private applyScaleToPolygon(polygonId: Id, newPos: SheetPosition, superHeld: boolean): void {
    if (!this.resizeMode || !this.resizeOriginalBoundingBox || !this.resizeOriginalPoints) {
      return;
    }

    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const bbox = this.resizeOriginalBoundingBox;
    const pin = this.resizeMode.type === 'corner'
      ? this.getPinnedCorner(this.resizeMode.corner, bbox)
      : this.getPinnedEdge(this.resizeMode.edge, bbox).pinnedPos;

    let scaleX: number;
    let scaleY: number;

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
      scaleX = (newPos.x - pin.x) / (cornerX - pin.x);
      scaleY = (newPos.y - pin.y) / (cornerY - pin.y);
    } else {
      const edge = this.resizeMode.edge;
      if (edge === 'left' || edge === 'right') {
        scaleX = Math.abs(newPos.x - pin.x) / bbox.width;
        scaleY = 1;
      } else {
        scaleX = 1;
        scaleY = Math.abs(newPos.y - pin.y) / bbox.height;
      }
    }

    if (superHeld) {
      const minScale = Math.min(Math.abs(scaleX), Math.abs(scaleY));
      scaleX = Math.sign(scaleX) * minScale;
      scaleY = Math.sign(scaleY) * minScale;
    }

    polygon.points = this.resizeOriginalPoints.map((seg) => {
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
    });
  }

  /** Starts resizing a polygon via a corner handle. */
  onCornerHandlePointerDown(
    viewportControls: ViewportControls,
    polygonId: Id,
    corner: ResizeCorner,
  ): void {
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const originalPoints = polygon.points.map(seg => ({ ...seg }));
    const pointsArray = originalPoints.map(seg => seg.point);
    const bbox = boundingBox(pointsArray);

    this.resizeMode = { type: 'corner', corner };
    this.resizeOriginalBoundingBox = bbox;
    this.resizeOriginalPoints = originalPoints;
    this.draggingPolygonId = polygonId;
    this.emit('dragStateChange', polygonId);

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
        this.applyScaleToPolygon(this.draggingPolygonId, snapped, superHeld);
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const afterSegments = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.resizeOriginalPoints.map(seg => ({ ...seg }));
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
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const originalPoints = polygon.points.map(seg => ({ ...seg }));
    const pointsArray = originalPoints.map(seg => seg.point);
    const bbox = boundingBox(pointsArray);

    this.resizeMode = { type: 'edge', edge };
    this.resizeOriginalBoundingBox = bbox;
    this.resizeOriginalPoints = originalPoints;
    this.draggingPolygonId = polygonId;
    this.emit('dragStateChange', polygonId);

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
        this.applyScaleToPolygon(this.draggingPolygonId, snapped, superHeld);
      },
      onCommit: (_sp) => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const afterSegments = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.resizeOriginalPoints;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i += 1) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.getHistoryManager().recordMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.resizeOriginalPoints) {
          const polygon = this.getPolygonStore().polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.resizeOriginalPoints.map(seg => ({ ...seg }));
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Deletes all currently selected polygons, recording to history. */
  private deleteSelectedPolygons(): void {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getPolygonStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getPolygonStore().deletePolygon(id);
      }
    }
    this.getSelectionManager().clearSelection();
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
}
