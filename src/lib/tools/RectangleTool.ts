import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { BaseTool } from './BaseTool';

export type RectangleToolEvents = {
  isCenterModeChange: (isCenterMode: boolean) => void;
};

/** A tool for creating rectangles. */
export class RectangleTool extends BaseTool<RectangleToolEvents> {
  type = "rectangle" as const;

  previewSheetPos: SheetPosition | null = null;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingRectangle();
    this.previewSheetPos = null;
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = this.applySnapping(sheetPos);
    const store = this.getGeometryStore();
    const wr = store.workingRectangle;

    if (!wr || wr.firstPoint === null) {
      store.setWorkingRectangle({
        firstPoint: snapped,
        previewLowerRight: null,
        isCenterMode: this.toolManager.getAltHeld(),
      });
    } else {
      this.completeRectangle(snapped);
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.updatePreview(viewport);
  }

  getCursor(): string {
    return 'pointer';
  }

  private computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    return applySnapping(sheetPos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: false,
      superHeld: false,
    });
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.abortRectangle();
    } else if (event.key === 'Enter') {
      const wr = this.getGeometryStore().workingRectangle;
      if (wr && wr.firstPoint && wr.previewLowerRight) {
        this.completeRectangle(wr.previewLowerRight);
      }
    } else if (event.key === 'Alt') {
      const wr = this.getGeometryStore().workingRectangle;
      if (wr && wr.firstPoint !== null) {
        const newIsCenterMode = !wr.isCenterMode;
        this.getGeometryStore().setWorkingRectangle({
          ...wr,
          isCenterMode: newIsCenterMode,
        });
        this.emit('isCenterModeChange', newIsCenterMode);
      }
    }
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Alt') {
      const wr = this.getGeometryStore().workingRectangle;
      if (wr && wr.firstPoint !== null) {
        const newIsCenterMode = this.toolManager.getAltHeld();
        if (wr.isCenterMode !== newIsCenterMode) {
          this.getGeometryStore().setWorkingRectangle({
            ...wr,
            isCenterMode: newIsCenterMode,
          });
          this.emit('isCenterModeChange', newIsCenterMode);
        }
      }
    }
  }

  private updatePreview(viewport: ViewportState): void {
    const store = this.getGeometryStore();
    const wr = store.workingRectangle;
    if (!wr || wr.firstPoint === null || !this.previewSheetPos) {
      return;
    }

    let previewLowerRight: SheetPosition;
    if (this.toolManager.getShiftHeld()) {
      previewLowerRight = this.computeSquareLowerRight(wr.firstPoint, this.previewSheetPos);
    } else {
      previewLowerRight = this.applySnapping(this.previewSheetPos);
    }

    store.setWorkingRectangle({
      ...wr,
      previewLowerRight,
    });
  }

  private computeSquareLowerRight(firstPoint: SheetPosition, targetPoint: SheetPosition): SheetPosition {
    const dx = targetPoint.x - firstPoint.x;
    const dy = targetPoint.y - firstPoint.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    return new SheetPosition(
      firstPoint.x + signX * dist,
      firstPoint.y + signY * dist,
    );
  }

  private completeRectangle(lowerRight: SheetPosition): void {
    const wr = this.getGeometryStore().workingRectangle;
    if (!wr || wr.firstPoint === null) {
      return;
    }

    const firstPoint = wr.firstPoint;
    let upperLeft: SheetPosition;
    let lowerRightAdjusted: SheetPosition;

    if (wr.isCenterMode) {
      const center = firstPoint;
      const dx = Math.abs(lowerRight.x - center.x);
      const dy = Math.abs(lowerRight.y - center.y);
      upperLeft = new SheetPosition(center.x - dx, center.y - dy);
      lowerRightAdjusted = new SheetPosition(center.x + dx, center.y + dy);
    } else {
      upperLeft = new SheetPosition(
        Math.min(firstPoint.x, lowerRight.x),
        Math.min(firstPoint.y, lowerRight.y),
      );
      lowerRightAdjusted = new SheetPosition(
        Math.max(firstPoint.x, lowerRight.x),
        Math.max(firstPoint.y, lowerRight.y),
      );
    }

    this.getGeometryStore().addRectangle({
      upperLeft,
      lowerRight: lowerRightAdjusted,
    });
    this.getGeometryStore().clearWorkingRectangle();
    this.previewSheetPos = null;
  }

  private abortRectangle(): void {
    this.getGeometryStore().clearWorkingRectangle();
    this.previewSheetPos = null;
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}
