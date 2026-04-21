import EventEmitter from 'eventemitter3';
import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { PolygonStore } from './PolygonStore';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint } from '../math';
import type { ToolType, Polygon } from './types';

export type ToolManagerEvents = {
  toolChange: (tool: ToolType) => void;
  cursorChange: (cursor: string) => void;
  arcDrawModeChange: (mode: "quadratic" | "cubic") => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
};

export class ToolManager extends EventEmitter<ToolManagerEvents> {
  currentTool: ToolType = 'select';
  private polygonStore: PolygonStore;
  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private altHeld: boolean = false;
  private snappingOptions: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>;
  previewSheetPos: SheetPosition | null = null;

  public arcDrawMode: "quadratic" | "cubic" = "quadratic";
  public isHoveringFirstHandle: boolean = false;
  /** Whether the Alt key was held at the moment the user started hovering the first handle.
   *  Used to determine whether clicking the first handle should start an arc-close
   *  flow (alt held on hover) vs normal polygon close. */
  private altHeldOnFirstHandleHover: boolean = false;

  constructor(polygonStore: PolygonStore) {
    super();
    this.polygonStore = polygonStore;
    this.snappingOptions = { primaryGridSize: 1, secondaryGridSize: 0.2 };
  }

  setTool(tool: ToolType): void {
    if (this.currentTool !== tool) {
      if (this.currentTool === 'polygon' && this.polygonStore.workingPolygon) {
        this.polygonStore.clearWorkingPolygon();
      }
      this.currentTool = tool;
      this.emit('toolChange', tool);
      this.emit('cursorChange', this.getCursor());
    }
  }

  getTool(): ToolType {
    return this.currentTool;
  }

  getPolygonStore(): PolygonStore {
    return this.polygonStore;
  }

  getCursor(): string {
    switch (this.currentTool) {
      case 'move':
        return 'grab';
      case 'polygon':
        return 'crosshair';
      default:
        return 'default';
    }
  }

  setModifierKeys(shift: boolean, super_: boolean): void {
    this.shiftHeld = shift;
    this.superHeld = super_;
  }

  setHoveringFirstHandle(hovering: boolean): void {
    if (this.isHoveringFirstHandle !== hovering) {
      this.isHoveringFirstHandle = hovering;
      this.emit('hoveringFirstHandleChange', hovering);
      // Capture whether alt was held at the moment hover started.
      // This is used to determine arc-close vs normal close behavior on click.
      if (hovering) {
        this.altHeldOnFirstHandleHover = this.altHeld;
      }
    }
  }

  /** Resets transient preview/interaction state. Used by tests to ensure clean state between tests.
   *  Note: does NOT reset altHeldOnFirstHandleHover — that is set by handleMouseMove on the
   *  hover transition and should only be reset by a new hover transition.
   *  Use resetForTesting() to also reset altHeldOnFirstHandleHover. */
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

  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.snappingOptions = options;
  }

  syncSnappingOptions(scale: number): void {
    const grid = getGridAtScale(scale);
    this.snappingOptions = {
      primaryGridSize: grid.primaryCm,
      secondaryGridSize: grid.secondaryCm,
    };
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (this.currentTool === 'polygon') {
      this.handlePolygonClick(screenPos, viewport);
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    if (this.currentTool === 'polygon') {
      this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
      this.updatePreview(screenPos, viewport);
    }
  }

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

  handleKeyDown(event: KeyboardEvent): void {
    if (this.currentTool === 'polygon') {
      if (event.key === 'Escape') {
        this.abortPolygon();
      } else if (event.key === 'Enter') {
        this.completePolygon(false);
      } else if (event.key === 'b' || event.key === 'B') {
        this.setArcDrawMode('cubic');
      } else if (event.key === 'm' || event.key === 'M') {
        this.setArcDrawMode('quadratic');
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

  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    const wp = this.polygonStore.workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      this.arcDrawMode = mode;
      this.emit('arcDrawModeChange', mode);
    }
  }

  private handlePolygonClick(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const wp = this.polygonStore.workingPolygon;

    if (!wp) {
      if (this.previewSheetPos) {
        this.polygonStore.setWorkingPolygon({
          points: [{ type: "point", point: this.previewSheetPos }],
          previewPoint: null,
          pendingArcEndPoint: null,
        });
      }
      return;
    }

    // First handle click with alt held on hover: start arc-back-to-first-point flow.
    // The user hovered the first handle while holding Alt, and now clicking it
    // should not close the polygon — instead it should set the arc endpoint to
    // the first point and let the user pick a control point to complete the arc.
    if (wp.points.length >= 2 && this.isHoveringFirstHandle) {
      if (this.altHeldOnFirstHandleHover) {
        const firstPoint = wp.points[0].point;
        this.setHoveringFirstHandle(false);
        this.polygonStore.setWorkingPolygon({
          ...wp,
          pendingArcEndPoint: firstPoint,
        });
        return;
      } else {
        this.setHoveringFirstHandle(false);
        this.completePolygon(true);
        return;
      }
    }

    this.addPoint(worldPos);
  }

  completePolygonAtFirstHandle(): void {
    this.completePolygon(true);

    // After completing a polygon, reset the first handle hovering state.
    this.setHoveringFirstHandle(false);
  }

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
        wp.points.push({ type: "arc-quadratic", point: arcEnd, controlPoint: snapped });
      } else {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: "arc-cubic", point: arcEnd, controlPointA: snapped, controlPointB });
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
      wp.points.push({ type: "point", point: snapped });
    }

    this.polygonStore.setWorkingPolygon({ ...wp });
  }

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

  private completePolygon(closed: boolean): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp || wp.points.length < 2) {
      this.polygonStore.clearWorkingPolygon();
      return;
    }

    // If pendingArcEndPoint is the first point, the user just placed the closing arc.
    // Force closed=true so the polygon closes automatically.
    if (wp.pendingArcEndPoint !== null &&
        wp.pendingArcEndPoint.x === wp.points[0].point.x &&
        wp.pendingArcEndPoint.y === wp.points[0].point.y) {
      closed = true;
    }

    const polygon: Polygon = {
      id: crypto.randomUUID(),
      points: wp.points,
      closed,
    };

    this.polygonStore.addPolygon(polygon);
    this.polygonStore.clearWorkingPolygon();
  }

  private abortPolygon(): void {
    const wp = this.polygonStore.workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.polygonStore.setWorkingPolygon({ ...wp });
    } else {
      this.polygonStore.clearWorkingPolygon();
    }
  }

  private applySnapping(pos: SheetPosition, prevPoint: SheetPosition | null): SheetPosition {
    return applySnapping(pos, prevPoint, {
      primaryGridSize: this.snappingOptions.primaryGridSize,
      secondaryGridSize: this.snappingOptions.secondaryGridSize,
      shiftHeld: this.shiftHeld,
      superHeld: this.superHeld,
    });
  }
}
