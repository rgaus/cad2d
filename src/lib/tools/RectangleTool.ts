import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { BaseTool } from './BaseTool';
import { DEFAULT_COLOR } from './GeometryStore';
import { WorkingConstraint } from './types';

export type RectangleToolEvents = {
  isCenterModeChange: (isCenterMode: boolean) => void;
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

/** A tool for creating rectangles. */
export class RectangleTool extends BaseTool<RectangleToolEvents> {
  type = "rectangle" as const;
  focusKeyCombo = 'r' as const;

  previewSheetPos: SheetPosition | null = null;

  private constrainedWidth: number | null = null;
  private constrainedHeight: number | null = null;

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

      this.getGeometryStore().setWorkingConstraints([
        {
          type: "linear",
          pointA: snapped,
          pointB: snapped,
          constrainedLength: null,
          disabled: false,
        },
        {
          type: "linear",
          pointA: snapped,
          pointB: snapped,
          constrainedLength: null,
          disabled: false,
        },
      ]);
      this.getGeometryStore().on('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
    } else {
      this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
      const { previewLowerRight } = this.updatePreview();
      this.completeRectangle(previewLowerRight ?? snapped);
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    const { previewLowerRight, isSquare } = this.updatePreview();

    const wr = this.getGeometryStore().workingRectangle;
    if (!wr || wr.firstPoint === null) {
      this.emit('previewSheetPositionChange', this.previewSheetPos);
    }

    // Update the working constraints to measure rectangle width and height
    if (wr && wr.firstPoint && previewLowerRight) {
      let upperLeft = wr.firstPoint!;
      let lowerRight = previewLowerRight;
      if (wr.isCenterMode) {
        const center = wr.firstPoint;
        const dx = Math.abs(lowerRight.x - center.x);
        const dy = Math.abs(lowerRight.y - center.y);
        upperLeft = new SheetPosition(center.x - dx, center.y - dy);
        lowerRight = new SheetPosition(center.x + dx, center.y + dy);
      } else {
        upperLeft = new SheetPosition(
          Math.min(wr.firstPoint.x, lowerRight.x),
          Math.min(wr.firstPoint.y, lowerRight.y),
        );
        lowerRight = new SheetPosition(
          Math.max(wr.firstPoint.x, lowerRight.x),
          Math.max(wr.firstPoint.y, lowerRight.y),
        );
      }

      if (isSquare) {
        // If the rectangle is a square, then make the single editable constraint value fall back
        // to whatever dimension is set.
        //
        // This ensures that if the user puts a value into the "y" dimension, THEN presses shift,
        // the constraint still applies
        this.getGeometryStore().setWorkingConstraints((old) => [
          {
            ...old[0],
            type: "linear",
            pointA: upperLeft,
            pointB: new SheetPosition(lowerRight.x, upperLeft.y),
            constrainedLength: old[0].constrainedLength ?? old[1].constrainedLength,
          },
          {
            ...old[1],
            type: "linear",
            pointA: upperLeft,
            pointB: new SheetPosition(upperLeft.x, lowerRight.y),
            disabled: true,
            constrainedLength: null,
          },
        ]);
      } else {
        this.getGeometryStore().setWorkingConstraints((old) => [
          {
            ...old[0],
            type: "linear",
            pointA: upperLeft,
            pointB: new SheetPosition(lowerRight.x, upperLeft.y),
            disabled: false,
          },
          {
            ...old[1],
            type: "linear",
            pointA: upperLeft,
            pointB: new SheetPosition(upperLeft.x, lowerRight.y),
            disabled: false,
          },
        ]);
      }
    }
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

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortRectangle();
      return true;
    } else if (event.key === 'Enter') {
      const wr = this.getGeometryStore().workingRectangle;
      if (wr && wr.firstPoint && wr.previewLowerRight) {
        this.completeRectangle(wr.previewLowerRight);
        return true;
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
        return true;
      }
    }
    return false;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
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
          return true;
        }
      }
    }
    return false;
  }

  private handleWorkingConstraintsChanged = (workingConstraints: Array<WorkingConstraint>) => {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const [topConstraint, leftConstraint] = workingConstraints;
    if (topConstraint && topConstraint.constrainedLength !== null) {
      this.constrainedWidth = topConstraint.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
    } else {
      this.constrainedWidth = null;
    }
    if (leftConstraint && leftConstraint.constrainedLength !== null) {
      this.constrainedHeight = leftConstraint.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
    } else {
      this.constrainedHeight = null;
    }
    this.updatePreview();
    // TODO: also update the working contraints to make them match this.constrainedWidth / this.constrainedHeight
    // But this is tricky because updating them here would cause a loop (update ->
    // handleWorkingConstraintsChanged -> update -> etc). So there needs to be some cycle detection / breaking.
  };

  private updatePreview(): { previewLowerRight: SheetPosition | null, isSquare: boolean } {
    const store = this.getGeometryStore();
    const wr = store.workingRectangle;
    if (!wr || wr.firstPoint === null || !this.previewSheetPos) {
      return { previewLowerRight: null, isSquare: false };
    }

    let previewLowerRight: SheetPosition;
    let isSquare = false;
    if (this.toolManager.getShiftHeld()) {
      previewLowerRight = this.computeSquareLowerRight(wr.firstPoint, this.previewSheetPos);
      isSquare = true;
    } else {
      previewLowerRight = this.applySnapping(this.previewSheetPos);
      if (typeof this.constrainedWidth === 'number') {
        if (wr.isCenterMode) {
          previewLowerRight = new SheetPosition(wr.firstPoint.x + (this.constrainedWidth / 2), previewLowerRight.y);
        } else {
          previewLowerRight = new SheetPosition(wr.firstPoint.x + this.constrainedWidth, previewLowerRight.y);
        }
      }
      if (typeof this.constrainedHeight === 'number') {
        if (wr.isCenterMode) {
          previewLowerRight = new SheetPosition(previewLowerRight.x, wr.firstPoint.y + (this.constrainedHeight / 2));
        } else {
          previewLowerRight = new SheetPosition(previewLowerRight.x, wr.firstPoint.y + this.constrainedHeight);
        }
      }
    }

    store.setWorkingRectangle({
      ...wr,
      previewLowerRight,
    });

    return { previewLowerRight, isSquare };
  }

  private computeSquareLowerRight(firstPoint: SheetPosition, targetPoint: SheetPosition): SheetPosition {
    const dx = targetPoint.x - firstPoint.x;
    const dy = targetPoint.y - firstPoint.y;
    let dist = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;

    if (typeof this.constrainedWidth === 'number') {
      // Override the size of the square if the first selected dimension (ie, width) is constrained
      dist = this.constrainedWidth;
    }

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

    if (upperLeft.x == lowerRightAdjusted.x && upperLeft.y === lowerRightAdjusted.y) {
      // Don't allow creating 0 size rectangles
      return;
    }

    // Add newly created rectangle
    this.getGeometryStore().addRectangle({
      upperLeft,
      lowerRight: lowerRightAdjusted,
      fillColor: DEFAULT_COLOR,
      linkDimensions: this.toolManager.getShiftHeld(),
    });
    this.getGeometryStore().clearWorkingRectangle();

    // Add a constraint on top and left, if the user entered a value
    const [topConstraint, leftConstraint] = this.getGeometryStore().workingConstraints;
    if (topConstraint.constrainedLength !== null) {
      this.getGeometryStore().addConstraint({
        type: "linear",
        pointA: topConstraint.pointA,
        pointB: topConstraint.pointB,
        constrainedLength: topConstraint.constrainedLength,
        connectorLineOffsetPx: -1 * 12,
      });
    }
    if (leftConstraint.constrainedLength !== null) {
      this.getGeometryStore().addConstraint({
        type: "linear",
        pointA: leftConstraint.pointA,
        pointB: leftConstraint.pointB,
        constrainedLength: leftConstraint.constrainedLength,
        connectorLineOffsetPx: -1 * 12,
      });
    }
    this.getGeometryStore().clearWorkingConstraints();
    this.getGeometryStore().off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private abortRectangle(): void {
    this.getGeometryStore().clearWorkingRectangle();
    this.previewSheetPos = null;
    this.getGeometryStore().clearWorkingConstraints();
    this.getGeometryStore().off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
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
