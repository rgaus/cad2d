import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint } from '../math';
import { type DragListener } from '../drag/createDragListener';
import { BaseTool } from './BaseTool';

/** Events emitted by SelectTool. */
export type PolygonToolEvents = {
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
};

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private altHeld: boolean = false;

  /** The current arc drawing mode */
  public arcDrawMode: 'quadratic' | 'cubic' = 'quadratic';
  public isHoveringFirstHandle: boolean = false;
  /** Whether the Alt key was held at the moment the user started hovering the first handle. */
  private altHeldOnFirstHandleHover: boolean = false;

  private activeDragListener: DragListener | null = null;

  handleToolBlur(): void {
    this.getPolygonStore().clearWorkingPolygon();
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

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
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
      this.emit('arcDrawModeChange', mode);
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
