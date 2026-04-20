import EventEmitter from 'eventemitter3';
import { ScreenPosition, type ViewportState } from '../viewport/types';
import { PolygonStore } from './PolygonStore';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { SNAP_THRESHOLD_PX } from './constants';
import type { ToolType, Polygon, PolygonPoint } from './types';

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
    const wp = this.polygonStore.workingPolygon;

    if (!wp) {
      this.polygonStore.setWorkingPolygon({
        points: [{ x: worldPos.x, y: worldPos.y }],
        previewPoint: null,
      });
      return;
    }

    const first = wp.points[0];
    const firstViewportX = viewport.position.x + first.x * viewport.scale;
    const firstViewportY = viewport.position.y + first.y * viewport.scale;
    const firstScreenPos = new ScreenPosition(firstViewportX, firstViewportY);

    if (this.isWithinThreshold(screenPos, firstScreenPos)) {
      this.completePolygon(true);
    } else {
      this.addPoint(worldPos);
    }
  }

  private addPoint(worldPos: PolygonPoint): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const prevPoint = wp.points[wp.points.length - 1];
    const snapped = this.applySnapping(worldPos, prevPoint);

    wp.points.push({ x: snapped.x, y: snapped.y });
    this.polygonStore.setWorkingPolygon({ ...wp });
  }

  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.polygonStore.workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const prevPoint = wp.points[wp.points.length - 1];
    const snapped = this.applySnapping(worldPos, prevPoint);

    this.polygonStore.setWorkingPolygon({
      ...wp,
      previewPoint: { x: snapped.x, y: snapped.y },
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

  private applySnapping(pos: PolygonPoint, prevPoint: PolygonPoint | null): PolygonPoint {
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
