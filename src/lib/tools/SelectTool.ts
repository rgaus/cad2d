import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { type Id, type PolygonSegment, type QuadraticBezierSegment, type CubicBezierSegment } from './types';
import { createDragListener, type DragListener } from '../drag/createDragListener';
import { BaseTool } from './BaseTool';

/** Events emitted by SelectTool. */
export type SelectToolEvents = {
  dragStateChange: (draggingPolygonId: Id | null) => void;
};

/** A tool for selecting / manipulating polygons. */
export class SelectTool extends BaseTool<SelectToolEvents> {
  type = 'select' as const;

  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private altHeld: boolean = false;

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
  /** Stores the current viewport state for use during drags. Updated by setViewportState. */
  private currentViewportState: ViewportState | null = null;

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
  }

  /** Updates the current viewport state. Called by the renderer whenever the viewport changes (pan/zoom). */
  setViewportState(viewport: ViewportState): void {
    this.currentViewportState = viewport;
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
      shiftHeld: this.shiftHeld,
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

    if (event.key === 'Shift') {
      this.shiftHeld = true;
    }
    if (event.key === 'Meta' || event.key === 'Control') {
      this.superHeld = true;
    }
    if (event.key === 'Alt') {
      this.altHeld = true;
    }
  }

  /** Handles key up events to update modifier state. */
  handleKeyUp(event: KeyboardEvent) {
    if (event.key === 'Shift') {
      this.shiftHeld = false;
    }
    if (event.key === 'Meta' || event.key === 'Control') {
      this.superHeld = false;
    }
    if (event.key === 'Alt') {
      this.altHeld = false;
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
    viewport: ViewportState,
    polygonId: Id,
    segmentIndex: number,
  ): void {
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) {
      return;
    }

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const beforePoint = polygon.points[segmentIndex].point;

    this.draggingPolygonId = polygonId;
    this.draggingSegmentIndex = segmentIndex;
    this.draggingPointKey = 'vertex';
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygon.points.map(seg => ({ ...seg })) };
    this.currentViewportState = viewport;
    this.emit('dragStateChange', polygonId);

    this.activeDragListener = createDragListener({
      onMove: (sp) => {
        if (!this.draggingPolygonId) {
          return;
        }

        const liveViewport = this.currentViewportState ?? viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
          superHeld: false,
        });

        this.getPolygonStore().updatePolygon(this.draggingPolygonId, (prev) => {
          const points = prev.points.slice();
          points[this.draggingSegmentIndex] = {
            ...points[this.draggingSegmentIndex],
            point: snapped,
          };
          return { ...prev, points };
        });
      },
      onCommit: (sp) => {
        const liveViewport = this.currentViewportState ?? viewport;
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
    viewport: ViewportState,
    polygonId: Id,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
  ): void {
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    const worldPos = screenPos.toWorld(viewport);
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
    this.currentViewportState = viewport;
    this.emit('dragStateChange', polygonId);

    this.activeDragListener = createDragListener({
      onMove: (sp) => {
        const liveViewport = this.currentViewportState ?? viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
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
        const liveViewport = this.currentViewportState ?? viewport;
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
  onFillPointerDown(screenPos: ScreenPosition, viewport: ViewportState, polygonId: Id): void {
    const polygon = this.getPolygonStore().polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    this.draggingPolygonId = polygonId;
    this.dragStartSheetPos = sheetPos;
    this.originalPolygonState = { points: polygon.points.map(seg => ({ ...seg })) };
    this.currentViewportState = viewport;
    this.emit('dragStateChange', polygonId);

    this.activeDragListener = createDragListener({
      onMove: (sp) => {
        const liveViewport = this.currentViewportState ?? viewport;
        const world = sp.toWorld(liveViewport);
        const sheet = world.toSheet();
        const snapped = applySnapping(sheet, null, {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
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
          for (let i = 0; !changed && i < original.length; i++) {
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
      shiftHeld: this.shiftHeld,
      superHeld: this.superHeld,
    });
  }
}
