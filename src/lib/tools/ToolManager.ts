import EventEmitter from 'eventemitter3';
import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { PolygonStore } from './PolygonStore';
import { SelectionManager } from './SelectionManager';
import { HistoryManager } from '../history/HistoryManager';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint } from '../math';
import type { ToolType, Id, PolygonSegment, QuadraticBezierSegment, CubicBezierSegment } from './types';
import { createDragListener, type DragListener } from '../drag/createDragListener';

/** The base class of a tool which a user can use to interact with the sheet. */
abstract class Tool {
  protected toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    this.toolManager = toolManager;
  }

  /** Returns a string used to represent the given tool. */
  abstract type: ToolType;

  /** Returns the current cursor string for this tool. */
  getCursor() {
    return "default"
  }

  /** Called when a tool is selected by the user. */
  handleToolFocus(): void {}

  /** Called when a tool is de-selected by the user. */
  handleToolBlur(): void {}

  handleMouseDown(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleMouseMove(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleKeyDown(_event: KeyboardEvent): void {}
  handleKeyUp(_event: KeyboardEvent): void {}


  /** Returns the PolygonStore. */
  getPolygonStore(): PolygonStore {
    return this.toolManager.getPolygonStore();
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.toolManager.getSelectionManager();
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.toolManager.getHistoryManager();
  }
}

class SelectTool extends Tool {
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
    this.toolManager.emit('dragStateChange', null);
  }

  getCursor() {
    return 'default';
  }

  handleToolBlur(): void {
    this.getSelectionManager().clearSelection();
  }

  /** Sets the first handle hover state, capturing whether alt was held at hover start. */
  setHoveringFirstHandle(hovering: boolean): void {
    if (this.isHoveringFirstHandle !== hovering) {
      this.isHoveringFirstHandle = hovering;
      this.toolManager.emit('hoveringFirstHandleChange', hovering);
      if (hovering) {
        this.altHeldOnFirstHandleHover = this.altHeld;
      }
    }
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
    this.toolManager.emit('dragStateChange', polygonId);

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
    this.toolManager.emit('dragStateChange', polygonId);

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
    this.toolManager.emit('dragStateChange', polygonId);

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

class PolygonTool extends Tool {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private altHeld: boolean = false;

  /** The current arc drawing mode. */
  public arcDrawMode: 'quadratic' | 'cubic' = 'quadratic';
  public isHoveringFirstHandle: boolean = false;
  /** Whether the Alt key was held at the moment the user started hovering the first handle. */
  private altHeldOnFirstHandleHover: boolean = false;

  private activeDragListener: DragListener | null = null;

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
  }

  handleToolBlur(): void {
    this.getPolygonStore().clearWorkingPolygon();
  }

  /** Sets the first handle hover state, capturing whether alt was held at hover start. */
  setHoveringFirstHandle(hovering: boolean): void {
    if (this.isHoveringFirstHandle !== hovering) {
      this.isHoveringFirstHandle = hovering;
      this.toolManager.emit('hoveringFirstHandleChange', hovering);
      if (hovering) {
        this.altHeldOnFirstHandleHover = this.altHeld;
      }
    }
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
    this.altHeldOnFirstHandleHover = false;
  }

  /** Sets grid snapping options. */
  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.toolManager.snappingOptions = options;
  }

  /** Syncs snapping options to the current viewport scale. */
  syncSnappingOptions(scale: number): void {
    const grid = getGridAtScale(scale);
    this.toolManager.snappingOptions = {
      primaryGridSize: grid.primaryCm,
      secondaryGridSize: grid.secondaryCm,
    };
  }

  /** Handles a click in the polygon tool. */
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState) {
    const worldPos = screenPos.toWorld(viewport);
    const wp = this.getPolygonStore().workingPolygon;

    if (!wp) {
      if (this.previewSheetPos) {
        this.getPolygonStore().setWorkingPolygon({
          points: [{ type: 'point', point: this.previewSheetPos }],
          previewPoint: null,
          pendingArcEndPoint: null,
        });
      }
      return;
    }

    this.addPoint(worldPos);
  }

  /** Handles mouse move. In select mode, updates dragging during an active drag. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState) {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.updatePreview(screenPos, viewport);
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
      this.abortPolygon();
    } else if (event.key === 'Backspace') {
      this.clearLastPolygonSegment();
    } else if (event.key === 'Enter') {
      this.completePolygon(false);
    } else if (event.key === 'b' || event.key === 'B') {
      this.setArcDrawMode('cubic');
    } else if (event.key === 'm' || event.key === 'M') {
      this.setArcDrawMode('quadratic');
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

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      this.arcDrawMode = mode;
      this.toolManager.emit('arcDrawModeChange', mode);
    }
  }

  /** Completes the polygon at the first handle (arc-close or normal close). */
  completePolygonAtFirstHandle(): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length >= 2) {
      if (this.altHeldOnFirstHandleHover) {
        const firstPoint = wp.points[0].point;
        this.getPolygonStore().setWorkingPolygon({
          ...wp,
          pendingArcEndPoint: firstPoint,
        });
      } else {
        wp.points.push(wp.points[0]);
        this.getPolygonStore().setWorkingPolygon({ ...wp });

        this.completePolygon(true);
      }
    }

    this.setHoveringFirstHandle(false);
  }

  /** Adds a point or arc segment to the working polygon. */
  private addPoint(worldPos: WorldPosition): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (!wp) return;

    const sheetPos = worldPos.toSheet();
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;

    const snapped = this.applySnapping(sheetPos, prevPoint);

    if (wp.pendingArcEndPoint !== null) {
      const arcEnd = wp.pendingArcEndPoint;
      if (this.arcDrawMode === 'quadratic') {
        wp.points.push({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped });
      } else {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB });
      }
      wp.pendingArcEndPoint = null;
      this.getPolygonStore().setWorkingPolygon({ ...wp });
      if (arcEnd.x === wp.points[0].point.x && arcEnd.y === wp.points[0].point.y) {
        this.completePolygon(true);
      }
      return;
    } else if (this.altHeld) {
      wp.pendingArcEndPoint = snapped;
    } else {
      wp.points.push({ type: 'point', point: snapped });
    }

    this.getPolygonStore().setWorkingPolygon({ ...wp });
  }

  /** Updates the preview point on the working polygon. */
  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;
    const snapped = this.applySnapping(sheetPos, prevPoint);

    this.getPolygonStore().setWorkingPolygon({
      ...wp,
      previewPoint: snapped,
    });
  }

  /** Completes the working polygon and adds it to the store. */
  private completePolygon(closed: boolean): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (!wp || wp.points.length < 2) {
      this.getPolygonStore().clearWorkingPolygon();
      return;
    }

    this.getPolygonStore().addPolygon({
      points: wp.points,
      closed,
    });
    this.getPolygonStore().clearWorkingPolygon();
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.getPolygonStore().setWorkingPolygon({ ...wp });
    } else {
      this.getPolygonStore().clearWorkingPolygon();
    }
  }

  /** Removes the last segment from the working polygon. */
  private clearLastPolygonSegment(): void {
    const wp = this.getPolygonStore().workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length <= 1 || wp.pendingArcEndPoint !== null) {
      this.abortPolygon();
      return;
    }

    this.getPolygonStore().setWorkingPolygon({
      ...wp,
      points: wp.points.slice(0, -1),
    });
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

const TOOLS = [SelectTool, PolygonTool];

/** Events emitted by ToolManager. */
export type ToolManagerEvents = {
  toolChange: (tool: ToolType) => void;
  cursorChange: (cursor: string) => void;
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
  dragStateChange: (draggingPolygonId: Id | null) => void;
};

/**
 * Manages the current tool, polygon drawing, selection, and undo/redo integration.
 * Handles input events and coordinates with PolygonStore, SelectionManager, and HistoryManager.
 */
export class ToolManager extends EventEmitter<ToolManagerEvents> {
  private tools: Array<Tool>;
  private activeToolIndex: number = 0;

  currentTool: ToolType = 'select';
  private polygonStore: PolygonStore;
  private selectionManager: SelectionManager;
  private historyManager: HistoryManager;
  snappingOptions: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>;
  previewSheetPos: SheetPosition | null = null;

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

  constructor(polygonStore: PolygonStore, selectionManager: SelectionManager, historyManager: HistoryManager) {
    super();
    this.polygonStore = polygonStore;
    this.selectionManager = selectionManager;
    this.historyManager = historyManager;
    this.snappingOptions = { primaryGridSize: 1, secondaryGridSize: 0.2 };

    this.tools = TOOLS.map((ToolClass) => new ToolClass(this));
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

  /** Changes the active tool. */
  setTool(toolType: ToolType): void {
    if (this.currentTool === toolType) {
      return;
    }

    const toolIndex = this.tools.findIndex(tool => tool.type === toolType);
    if (toolIndex < 0) {
      throw new Error(`ToolManager.setTool: No tool with type ${toolType} found in tools list.`);
    }

    // Blur the old tool
    this.getActiveTool().handleToolBlur();

    this.activeToolIndex = toolIndex;

    // Focus the new tool
    this.getActiveTool().handleToolFocus();

    if (this.currentTool === 'polygon' && this.polygonStore.workingPolygon) {
      this.polygonStore.clearWorkingPolygon();
    }
    if (this.currentTool === 'select') {
      this.selectionManager.clearSelection();
    }
    this.currentTool = toolType;
    this.emit('toolChange', toolType);
    this.emit('cursorChange', this.getCursor());
  }

  getActiveTool(): Tool {
    return this.tools[this.activeToolIndex];
  }

  /** Returns the current active tool. */
  getTool(): ToolType {
    return this.currentTool;
  }

  /** Returns the PolygonStore. */
  getPolygonStore(): PolygonStore {
    return this.polygonStore;
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.selectionManager;
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    switch (this.currentTool) {
      case 'move':
        return 'grab';
      case 'polygon':
        return 'pointer';
      default:
        return 'default';
    }
  }

  /** Sets the first handle hover state, capturing whether alt was held at hover start. */
  setHoveringFirstHandle(hovering: boolean): void {
    if (this.isHoveringFirstHandle !== hovering) {
      this.isHoveringFirstHandle = hovering;
      this.emit('hoveringFirstHandleChange', hovering);
      if (hovering) {
        this.altHeldOnFirstHandleHover = this.altHeld;
      }
    }
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
    this.altHeldOnFirstHandleHover = false;
  }

  /** Sets grid snapping options. */
  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.snappingOptions = options;
  }

  /** Syncs snapping options to the current viewport scale. */
  syncSnappingOptions(scale: number): void {
    const grid = getGridAtScale(scale);
    this.snappingOptions = {
      primaryGridSize: grid.primaryCm,
      secondaryGridSize: grid.secondaryCm,
    };
  }

  /** Handles mouse down. In select mode, delegates to the selection handler via events. */
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (this.currentTool === 'polygon') {
      this.handlePolygonClick(screenPos, viewport);
    }
  }

  /** Handles mouse move. In select mode, updates dragging during an active drag. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (this.currentTool === 'polygon') {
      this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
      this.updatePreview(screenPos, viewport);
    }
  }

  /** Computes the snapped position for the polygon tool preview. */
  computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    return applySnapping(sheetPos, null, {
      primaryGridSize: this.snappingOptions.primaryGridSize,
      secondaryGridSize: this.snappingOptions.secondaryGridSize,
      shiftHeld: this.shiftHeld,
      superHeld: false,
    });
  }

  /** Handles key down events for polygon drawing and select tool shortcuts. */
  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (this.activeDragListener) {
        this.cancelActiveDrag();
        return;
      }
      if (this.currentTool === 'select') {
        this.selectionManager.clearSelection();
      }
    }

    if (this.currentTool === 'polygon') {
      if (event.key === 'Escape') {
        this.abortPolygon();
      } else if (event.key === 'Backspace') {
        this.clearLastPolygonSegment();
      } else if (event.key === 'Enter') {
        this.completePolygon(false);
      } else if (event.key === 'b' || event.key === 'B') {
        this.setArcDrawMode('cubic');
      } else if (event.key === 'm' || event.key === 'M') {
        this.setArcDrawMode('quadratic');
      }
    } else if (this.currentTool === 'select') {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        this.deleteSelectedPolygons();
      }
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
  handleKeyUp(event: KeyboardEvent): void {
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

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    const wp = this.polygonStore.workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      this.arcDrawMode = mode;
      this.emit('arcDrawModeChange', mode);
    }
  }

  /** Handles a click in the polygon tool. */
  private handlePolygonClick(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const wp = this.polygonStore.workingPolygon;

    if (!wp) {
      if (this.previewSheetPos) {
        this.polygonStore.setWorkingPolygon({
          points: [{ type: 'point', point: this.previewSheetPos }],
          previewPoint: null,
          pendingArcEndPoint: null,
        });
      }
      return;
    }

    this.addPoint(worldPos);
  }

  /** Called by the renderer when a polygon fill is clicked in select mode. */
  handlePolygonSelect(polygonId: Id, addToSelection: boolean): void {
    if (!addToSelection) {
      this.selectionManager.clearSelection();
    }
    this.selectionManager.toggle(polygonId);
  }

  /** Starts dragging a vertex handle. Called from renderer pointer down on vertex handles. */
  onVertexPointerDown(
    screenPos: ScreenPosition,
    viewport: ViewportState,
    polygonId: Id,
    segmentIndex: number,
  ): void {
    const polygon = this.polygonStore.polygons.find(p => p.id === polygonId);
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
          primaryGridSize: this.snappingOptions.primaryGridSize,
          secondaryGridSize: this.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
          superHeld: false,
        });

        this.polygonStore.updatePolygon(this.draggingPolygonId, (prev) => {
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
          this.historyManager.recordMoveVertex(
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
          const polygon = this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId);
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
    const polygon = this.polygonStore.polygons.find(p => p.id === polygonId);
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
          primaryGridSize: this.snappingOptions.primaryGridSize,
          secondaryGridSize: this.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
          superHeld: false,
        });
        const segments = [...this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId)!.points];
        if (this.draggingPointKey === 'controlPoint') {
          const seg = segments[this.draggingSegmentIndex] as QuadraticBezierSegment;
          segments[this.draggingSegmentIndex] = { ...seg, controlPoint: snapped };
        } else {
          const seg = segments[this.draggingSegmentIndex] as CubicBezierSegment;
          segments[this.draggingSegmentIndex] = { ...seg, [this.draggingPointKey]: snapped };
        }
        this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId)!.points = segments;
      },
      onCommit: (sp) => {
        const liveViewport = this.currentViewportState ?? viewport;
        const world = sp.toWorld(liveViewport);
        const afterPoint = world.toSheet();
        if (this.draggingPolygonId && (beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y)) {
          this.historyManager.recordMoveControlPoint(
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
          const polygon = this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId);
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
    const polygon = this.polygonStore.polygons.find(p => p.id === polygonId);
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
          primaryGridSize: this.snappingOptions.primaryGridSize,
          secondaryGridSize: this.snappingOptions.secondaryGridSize,
          shiftHeld: this.shiftHeld,
          superHeld: false,
        });
        const polygon = this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId);
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
          const afterSegments = this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId)!.points;
          const original = this.originalPolygonState.points;
          let changed = original.length !== afterSegments.length;
          for (let i = 0; !changed && i < original.length; i++) {
            const origSeg = original[i];
            const afterSeg = afterSegments[i];
            changed = origSeg.point.x !== afterSeg.point.x || origSeg.point.y !== afterSeg.point.y;
          }
          if (changed) {
            this.historyManager.recordMove(this.draggingPolygonId, original, afterSegments);
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
      onCancel: () => {
        if (this.draggingPolygonId && this.originalPolygonState) {
          const polygon = this.polygonStore.polygons.find(p => p.id === this.draggingPolygonId);
          if (polygon) {
            polygon.points = this.originalPolygonState.points.map(seg => ({ ...seg }));
          }
        }
        this.activeDragListener = null;
        this.clearDragState();
      },
    });
  }

  /** Completes the polygon at the first handle (arc-close or normal close). */
  completePolygonAtFirstHandle(): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length >= 2) {
      if (this.altHeldOnFirstHandleHover) {
        const firstPoint = wp.points[0].point;
        this.polygonStore.setWorkingPolygon({
          ...wp,
          pendingArcEndPoint: firstPoint,
        });
      } else {
        wp.points.push(wp.points[0]);
        this.polygonStore.setWorkingPolygon({ ...wp });

        this.completePolygon(true);
      }
    }

    this.setHoveringFirstHandle(false);
  }

  /** Adds a point or arc segment to the working polygon. */
  private addPoint(worldPos: WorldPosition): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const sheetPos = worldPos.toSheet();
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;

    const snapped = this.applySnapping(sheetPos, prevPoint);

    if (wp.pendingArcEndPoint !== null) {
      const arcEnd = wp.pendingArcEndPoint;
      if (this.arcDrawMode === 'quadratic') {
        wp.points.push({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped });
      } else {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB });
      }
      wp.pendingArcEndPoint = null;
      this.polygonStore.setWorkingPolygon({ ...wp });
      if (arcEnd.x === wp.points[0].point.x && arcEnd.y === wp.points[0].point.y) {
        this.completePolygon(true);
      }
      return;
    } else if (this.altHeld) {
      wp.pendingArcEndPoint = snapped;
    } else {
      wp.points.push({ type: 'point', point: snapped });
    }

    this.polygonStore.setWorkingPolygon({ ...wp });
  }

  /** Updates the preview point on the working polygon. */
  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;
    const snapped = this.applySnapping(sheetPos, prevPoint);

    this.polygonStore.setWorkingPolygon({
      ...wp,
      previewPoint: snapped,
    });
  }

  /** Completes the working polygon and adds it to the store. */
  private completePolygon(closed: boolean): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp || wp.points.length < 2) {
      this.polygonStore.clearWorkingPolygon();
      return;
    }

    this.polygonStore.addPolygon({
      points: wp.points,
      closed,
    });
    this.polygonStore.clearWorkingPolygon();
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    const wp = this.polygonStore.workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.polygonStore.setWorkingPolygon({ ...wp });
    } else {
      this.polygonStore.clearWorkingPolygon();
    }
  }

  /** Removes the last segment from the working polygon. */
  private clearLastPolygonSegment(): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length <= 1 || wp.pendingArcEndPoint !== null) {
      this.abortPolygon();
      return;
    }

    this.polygonStore.setWorkingPolygon({
      ...wp,
      points: wp.points.slice(0, -1),
    });
  }

  /** Deletes all currently selected polygons, recording to history. */
  private deleteSelectedPolygons(): void {
    for (const id of this.selectionManager.getSelectedIds()) {
      const polygon = this.polygonStore.polygons.find(p => p.id === id);
      if (polygon) {
        this.polygonStore.deletePolygon(id);
      }
    }
    this.selectionManager.clearSelection();
  }

  /** Applies snapping to a sheet position. */
  private applySnapping(pos: SheetPosition, prevPoint: SheetPosition | null): SheetPosition {
    return applySnapping(pos, prevPoint, {
      primaryGridSize: this.snappingOptions.primaryGridSize,
      secondaryGridSize: this.snappingOptions.secondaryGridSize,
      shiftHeld: this.shiftHeld,
      superHeld: this.superHeld,
    });
  }
}

