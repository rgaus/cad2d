import EventEmitter from 'eventemitter3';
import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { getGridAtScale, CM_TO_PX } from '../viewport/grid';
import { PolygonStore } from './PolygonStore';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { SNAP_THRESHOLD_PX } from './constants';
import type { ToolType, Polygon } from './types';

export type ToolManagerEvents = {
  toolChange: (tool: ToolType) => void;
  cursorChange: (cursor: string) => void;
};

export class ToolManager extends EventEmitter<ToolManagerEvents> {
  currentTool: ToolType = 'select';
  private polygonStore: PolygonStore;
  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private snappingOptions: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>;

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
      this.updatePreview(screenPos, viewport);
    }
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.currentTool === 'polygon') {
      this.abortPolygon();
    } else if (event.key === 'Enter' && this.currentTool === 'polygon') {
      this.completePolygon(false);
    }

    if (event.key === 'Shift') {
      this.shiftHeld = true;
    }
    if (event.key === 'Meta' || event.key === 'Control') {
      this.superHeld = true;
    }
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') {
      this.shiftHeld = false;
    }
    if (event.key === 'Meta' || event.key === 'Control') {
      this.superHeld = false;
    }
  }

  private handlePolygonClick(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = SheetPosition.fromWorld(worldPos, CM_TO_PX);
    const wp = this.polygonStore.workingPolygon;

    if (!wp) {
      this.polygonStore.setWorkingPolygon({
        points: [sheetPos],
        previewPoint: null,
      });
      return;
    }

    const first = wp.points[0];
    const firstWorldPos = first.toWorld(CM_TO_PX);
    const firstViewportPos = firstWorldPos.toViewport(viewport);
    const firstScreenPos = firstViewportPos.toScreen(viewport);

    if (this.isWithinThreshold(screenPos, firstScreenPos)) {
      this.completePolygon(true);
    } else {
      this.addPoint(worldPos);
    }
  }

  private addPoint(worldPos: WorldPosition): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const sheetPos = SheetPosition.fromWorld(worldPos, CM_TO_PX);
    const prevPoint = wp.points[wp.points.length - 1];
    const snapped = this.applySnapping(sheetPos, prevPoint);

    wp.points.push(snapped);
    this.polygonStore.setWorkingPolygon({ ...wp });
  }

  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = SheetPosition.fromWorld(worldPos, CM_TO_PX);
    const prevPoint = wp.points[wp.points.length - 1];
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

    const polygon: Polygon = {
      id: crypto.randomUUID(),
      points: wp.points,
      closed,
    };

    this.polygonStore.addPolygon(polygon);
    this.polygonStore.clearWorkingPolygon();
  }

  private abortPolygon(): void {
    this.polygonStore.clearWorkingPolygon();
  }

  private applySnapping(pos: SheetPosition, prevPoint: SheetPosition | null): SheetPosition {
    return applySnapping(pos, prevPoint, {
      primaryGridSize: this.snappingOptions.primaryGridSize,
      secondaryGridSize: this.snappingOptions.secondaryGridSize,
      shiftHeld: this.shiftHeld,
      superHeld: this.superHeld,
    });
  }

  private isWithinThreshold(a: ScreenPosition, b: ScreenPosition): boolean {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) <= SNAP_THRESHOLD_PX;
  }
}
