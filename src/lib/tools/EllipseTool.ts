import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { BaseTool } from './BaseTool';

export type EllipseToolEvents = {
  isCenterModeChange: (isCenterMode: boolean) => void;
};

/** A tool for creating ellipses/circles. */
export class EllipseTool extends BaseTool<EllipseToolEvents> {
  type = "ellipse" as const;

  previewSheetPos: SheetPosition | null = null;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingEllipse();
    this.previewSheetPos = null;
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const snapped = this.applySnapping(sheetPos);
    const store = this.getGeometryStore();
    const we = store.workingEllipse;

    if (!we || we.firstPoint === null) {
      store.setWorkingEllipse({
        firstPoint: snapped,
        previewPoint: null,
        isCenterMode: this.toolManager.getAltHeld(),
      });
    } else {
      this.completeEllipse(snapped);
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
      this.abortEllipse();
    } else if (event.key === 'Enter') {
      const we = this.getGeometryStore().workingEllipse;
      if (we && we.firstPoint && we.previewPoint) {
        this.completeEllipse(we.previewPoint);
      }
    } else if (event.key === 'Alt') {
      const we = this.getGeometryStore().workingEllipse;
      if (we && we.firstPoint !== null) {
        const newIsCenterMode = !we.isCenterMode;
        this.getGeometryStore().setWorkingEllipse({
          ...we,
          isCenterMode: newIsCenterMode,
        });
        this.emit('isCenterModeChange', newIsCenterMode);
      }
    }
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Alt') {
      const we = this.getGeometryStore().workingEllipse;
      if (we && we.firstPoint !== null) {
        const newIsCenterMode = this.toolManager.getAltHeld();
        if (we.isCenterMode !== newIsCenterMode) {
          this.getGeometryStore().setWorkingEllipse({
            ...we,
            isCenterMode: newIsCenterMode,
          });
          this.emit('isCenterModeChange', newIsCenterMode);
        }
      }
    }
  }

  private updatePreview(viewport: ViewportState): void {
    const store = this.getGeometryStore();
    const we = store.workingEllipse;
    if (!we || we.firstPoint === null || !this.previewSheetPos) {
      return;
    }

    let previewPoint: SheetPosition;
    if (this.toolManager.getShiftHeld()) {
      previewPoint = this.computeCircularPoint(we.firstPoint, this.previewSheetPos);
    } else {
      previewPoint = this.applySnapping(this.previewSheetPos);
    }

    store.setWorkingEllipse({
      ...we,
      previewPoint,
    });
  }

  private computeCircularPoint(center: SheetPosition, targetPoint: SheetPosition): SheetPosition {
    const dx = targetPoint.x - center.x;
    const dy = targetPoint.y - center.y;
    const dist = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;
    return new SheetPosition(
      center.x + signX * dist,
      center.y + signY * dist,
    );
  }

  private completeEllipse(secondPoint: SheetPosition): void {
    const we = this.getGeometryStore().workingEllipse;
    if (!we || we.firstPoint === null) {
      return;
    }

    const firstPoint = we.firstPoint;
    let center: SheetPosition;
    let radiusX: number;
    let radiusY: number;

    if (we.isCenterMode) {
      center = firstPoint;
      radiusX = Math.abs(secondPoint.x - center.x);
      radiusY = Math.abs(secondPoint.y - center.y);
    } else {
      const upperLeft = new SheetPosition(
        Math.min(firstPoint.x, secondPoint.x),
        Math.min(firstPoint.y, secondPoint.y),
      );
      const lowerRight = new SheetPosition(
        Math.max(firstPoint.x, secondPoint.x),
        Math.max(firstPoint.y, secondPoint.y),
      );
      center = new SheetPosition(
        (upperLeft.x + lowerRight.x) / 2,
        (upperLeft.y + lowerRight.y) / 2,
      );
      radiusX = (lowerRight.x - upperLeft.x) / 2;
      radiusY = (lowerRight.y - upperLeft.y) / 2;
    }

    if (radiusX <= 0 || radiusY <= 0) {
      this.abortEllipse();
      return;
    }

    this.getGeometryStore().addEllipse({
      center,
      radiusX,
      radiusY,
    });
    this.getGeometryStore().clearWorkingEllipse();
    this.previewSheetPos = null;
  }

  private abortEllipse(): void {
    this.getGeometryStore().clearWorkingEllipse();
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
