import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { BaseTool } from './BaseTool';
import { DEFAULT_COLOR } from './GeometryStore';
import { WorkingConstraint } from './types';
import { LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX } from '../geometry/types';

export type EllipseToolEvents = {
  isCenterModeChange: (isCenterMode: boolean) => void;
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

/** A tool for creating ellipses/circles. */
export class EllipseTool extends BaseTool<EllipseToolEvents> {
  type = "ellipse" as const;
  focusKeyCombo = 'e' as const;

  previewSheetPos: SheetPosition | null = null;

  private constrainedRadiusX: number | null = null;
  private constrainedRadiusY: number | null = null;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingEllipse();
    this.previewSheetPos = null;
    this.getGeometryStore().clearWorkingConstraints();
    this.getGeometryStore().off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
    this.emit('previewSheetPositionChange', null);
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

      this.getGeometryStore().setWorkingConstraints([
        {
          type: "linear",
          pointA: snapped,
          pointB: snapped,
          constrainedLength: null,
          connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
          disabled: false,
          shadowsConstraintId: null,
        },
        {
          type: "linear",
          pointA: snapped,
          pointB: snapped,
          constrainedLength: null,
          connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
          disabled: false,
          shadowsConstraintId: null,
        },
      ]);
      this.getGeometryStore().on('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
    } else {
      this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
      const { previewPoint } = this.updatePreview();
      this.completeEllipse(previewPoint ?? snapped);
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    const { previewPoint, isCircular } = this.updatePreview();
    const we = this.getGeometryStore().workingEllipse;
    if (!we || we.firstPoint === null) {
      this.emit('previewSheetPositionChange', this.previewSheetPos);
    }

    // Update working constraints to track ellipse radii
    if (we && we.firstPoint && previewPoint) {
      const center = we.isCenterMode ? we.firstPoint : this.computeCenterFromCornerMode(we.firstPoint, previewPoint);
      const radiusX = Math.abs(previewPoint.x - center.x);
      const radiusY = Math.abs(previewPoint.y - center.y);

      if (isCircular) {
        // In circular mode, make a single editable constraint value that applies to both
        this.getGeometryStore().setWorkingConstraints((old) => [
          {
            ...old[0],
            type: "linear",
            pointA: center,
            pointB: new SheetPosition(center.x + radiusX, center.y),
            constrainedLength: old[0].constrainedLength ?? old[1].constrainedLength,
          },
          {
            ...old[1],
            type: "linear",
            pointA: center,
            pointB: new SheetPosition(center.x, center.y - radiusY),
            disabled: true,
            constrainedLength: null,
          },
        ]);
      } else {
        this.getGeometryStore().setWorkingConstraints((old) => [
          {
            ...old[0],
            type: "linear",
            pointA: center,
            pointB: new SheetPosition(center.x + radiusX, center.y),
            disabled: false,
          },
          {
            ...old[1],
            type: "linear",
            pointA: center,
            pointB: new SheetPosition(center.x, center.y - radiusY),
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
      this.abortEllipse();
      return true;
    } else if (event.key === 'Enter') {
      const we = this.getGeometryStore().workingEllipse;
      if (we && we.firstPoint && we.previewPoint) {
        this.completeEllipse(we.previewPoint);
        return true;
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
        return true;
      }
    }
    return false;
  }

  handleKeyUp(event: KeyboardEvent): boolean {
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

    const [radiusXConstraint, radiusYConstraint] = workingConstraints;
    if (radiusXConstraint && radiusXConstraint.constrainedLength !== null) {
      this.constrainedRadiusX = radiusXConstraint.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
    } else {
      this.constrainedRadiusX = null;
    }
    if (radiusYConstraint && radiusYConstraint.constrainedLength !== null) {
      this.constrainedRadiusY = radiusYConstraint.constrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
    } else {
      this.constrainedRadiusY = null;
    }
    this.updatePreview();
  };

  private updatePreview(): { previewPoint: SheetPosition | null, isCircular: boolean } {
    const store = this.getGeometryStore();
    const we = store.workingEllipse;
    if (!we || we.firstPoint === null || !this.previewSheetPos) {
      return { previewPoint: null, isCircular: false };
    }

    let previewPoint: SheetPosition;
    let isCircular = false;
    if (this.toolManager.getShiftHeld()) {
      previewPoint = this.computeCircularPoint(we.firstPoint, this.previewSheetPos);
      isCircular = true;
    } else {
      previewPoint = this.applySnapping(this.previewSheetPos);
      if (typeof this.constrainedRadiusX === 'number') {
        const center = we.isCenterMode ? we.firstPoint : this.computeCenterFromCornerMode(we.firstPoint, this.previewSheetPos);
        const signX = previewPoint.x >= we.firstPoint.x ? 1 : -1;
        previewPoint = new SheetPosition(center.x + signX * this.constrainedRadiusX, previewPoint.y);
      }
      if (typeof this.constrainedRadiusY === 'number') {
        const center = we.isCenterMode ? we.firstPoint : this.computeCenterFromCornerMode(we.firstPoint, this.previewSheetPos);
        const signY = previewPoint.y >= we.firstPoint.y ? 1 : -1;
        previewPoint = new SheetPosition(previewPoint.x, center.y + signY * this.constrainedRadiusY);
      }
    }

    store.setWorkingEllipse({
      ...we,
      previewPoint,
    });

    return { previewPoint, isCircular };
  }

  private computeCenterFromCornerMode(firstPoint: SheetPosition, secondPoint: SheetPosition): SheetPosition {
    const upperLeft = new SheetPosition(
      Math.min(firstPoint.x, secondPoint.x),
      Math.min(firstPoint.y, secondPoint.y),
    );
    const lowerRight = new SheetPosition(
      Math.max(firstPoint.x, secondPoint.x),
      Math.max(firstPoint.y, secondPoint.y),
    );

    if (typeof this.constrainedRadiusX === 'number') {
      if (firstPoint.x <= secondPoint.x) {
        lowerRight.x = firstPoint.x + (this.constrainedRadiusX * 2);
      } else {
        upperLeft.x = firstPoint.x - (this.constrainedRadiusX * 2);
      }
    }
    if (typeof this.constrainedRadiusY === 'number') {
      if (firstPoint.x <= secondPoint.y) {
        lowerRight.y = firstPoint.y + (this.constrainedRadiusY * 2);
      } else {
        upperLeft.y = firstPoint.y - (this.constrainedRadiusY * 2);
      }
    }

    return new SheetPosition(
      (upperLeft.x + lowerRight.x) / 2,
      (upperLeft.y + lowerRight.y) / 2,
    );
  }

  private computeCircularPoint(center: SheetPosition, targetPoint: SheetPosition): SheetPosition {
    const dx = targetPoint.x - center.x;
    const dy = targetPoint.y - center.y;
    let dist = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;

    if (typeof this.constrainedRadiusX === 'number') {
      dist = this.constrainedRadiusX * 2 /* radius -> diameter */;
    }

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
      fillColor: DEFAULT_COLOR,
      linkDimensions: this.toolManager.getShiftHeld(),
    });
    this.getGeometryStore().clearWorkingEllipse();

    // Add constraints for the radii, if the user entered values
    const [radiusXConstraint, radiusYConstraint] = this.getGeometryStore().workingConstraints;
    if (radiusXConstraint && radiusXConstraint.constrainedLength !== null) {
      this.getGeometryStore().addConstraint({
        type: "linear",
        pointA: radiusXConstraint.pointA,
        pointB: radiusXConstraint.pointB,
        constrainedLength: radiusXConstraint.constrainedLength,
        connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      });
    }
    if (radiusYConstraint && radiusYConstraint.constrainedLength !== null) {
      this.getGeometryStore().addConstraint({
        type: "linear",
        pointA: radiusYConstraint.pointA,
        pointB: radiusYConstraint.pointB,
        constrainedLength: radiusYConstraint.constrainedLength,
        connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
      });
    }
    this.getGeometryStore().clearWorkingConstraints();
    this.getGeometryStore().off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private abortEllipse(): void {
    this.getGeometryStore().clearWorkingEllipse();
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
