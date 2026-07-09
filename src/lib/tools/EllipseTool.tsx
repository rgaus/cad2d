import { EllipseIcon } from 'lucide-react';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  ConstraintEndpoint,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
  LinearConstraint,
} from '@/lib/geometry/constraints';
import { Ellipse } from '@/lib/geometry/ellipse';
import { applySnapping } from '@/lib/snapping';
import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { WorkingConstraint } from './types';

export type EllipseToolEvents = {
  isCenterModeChange: (isCenterMode: boolean) => void;
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

/** A tool for creating ellipses/circles. */
export class EllipseTool extends BaseTool<EllipseToolEvents> {
  type = 'ellipse' as const;
  focusKeyCombo = 'e' as const;

  label = 'Ellipse';
  get icon(): React.ReactNode {
    return <EllipseIcon size={24} color="white" />;
  }

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
          type: 'linear',
          pointA: { type: 'point', point: snapped },
          pointB: { type: 'point', point: snapped },
          constrainedLength: null,
          connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
          disabled: false,
          shadowsConstraintId: null,
        },
        {
          type: 'linear',
          pointA: { type: 'point', point: snapped },
          pointB: { type: 'point', point: snapped },
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
      const center = we.isCenterMode
        ? we.firstPoint
        : this.computeCenterFromCornerMode(we.firstPoint, previewPoint);
      const radiusX = Math.abs(previewPoint.x - center.x);
      const radiusY = Math.abs(previewPoint.y - center.y);

      if (isCircular) {
        // In circular mode, make a single editable constraint value that applies to both
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old[0].type !== 'linear' || old[1].type !== 'linear') {
            return old;
          }
          return [
            {
              ...old[0],
              type: 'linear',
              pointA: { type: 'point', point: center },
              pointB: { type: 'point', point: new SheetPosition(center.x + radiusX, center.y) },
              constrainedLength: old[0].constrainedLength ?? old[1].constrainedLength,
            },
            {
              ...old[1],
              type: 'linear',
              pointA: { type: 'point', point: center },
              pointB: { type: 'point', point: new SheetPosition(center.x, center.y - radiusY) },
              disabled: true,
              constrainedLength: null,
            },
          ];
        });
      } else {
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old[0].type !== 'linear' || old[1].type !== 'linear') {
            return old;
          }
          return [
            {
              ...old[0],
              type: 'linear',
              pointA: { type: 'point', point: center },
              pointB: { type: 'point', point: new SheetPosition(center.x + radiusX, center.y) },
              disabled: false,
            },
            {
              ...old[1],
              type: 'linear',
              pointA: { type: 'point', point: center },
              pointB: { type: 'point', point: new SheetPosition(center.x, center.y - radiusY) },
              disabled: false,
            },
          ];
        });
      }
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
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
    if (
      radiusXConstraint &&
      radiusXConstraint.type === 'linear' &&
      radiusXConstraint.constrainedLength !== null
    ) {
      this.constrainedRadiusX = radiusXConstraint.constrainedLength.toSheetUnits(
        sheet.defaultUnit,
      ).magnitude;
    } else {
      this.constrainedRadiusX = null;
    }
    if (
      radiusYConstraint &&
      radiusYConstraint.type === 'linear' &&
      radiusYConstraint.constrainedLength !== null
    ) {
      this.constrainedRadiusY = radiusYConstraint.constrainedLength.toSheetUnits(
        sheet.defaultUnit,
      ).magnitude;
    } else {
      this.constrainedRadiusY = null;
    }
    this.updatePreview();
  };

  private updatePreview(): { previewPoint: SheetPosition | null; isCircular: boolean } {
    const store = this.getGeometryStore();
    const we = store.workingEllipse;
    if (!we || we.firstPoint === null || !this.previewSheetPos) {
      return { previewPoint: null, isCircular: false };
    }

    let previewPoint: SheetPosition;
    let isCircular = false;
    if (this.toolManager.getShiftHeld()) {
      previewPoint = this.computeCircularPoint(
        we.firstPoint,
        this.previewSheetPos,
        we.isCenterMode,
      );
      isCircular = true;
    } else {
      previewPoint = this.applySnapping(this.previewSheetPos);
      if (typeof this.constrainedRadiusX === 'number') {
        const center = we.isCenterMode
          ? we.firstPoint
          : this.computeCenterFromCornerMode(we.firstPoint, this.previewSheetPos);
        const signX = previewPoint.x >= we.firstPoint.x ? 1 : -1;
        previewPoint = new SheetPosition(
          center.x + signX * this.constrainedRadiusX,
          previewPoint.y,
        );
      }
      if (typeof this.constrainedRadiusY === 'number') {
        const center = we.isCenterMode
          ? we.firstPoint
          : this.computeCenterFromCornerMode(we.firstPoint, this.previewSheetPos);
        const signY = previewPoint.y >= we.firstPoint.y ? 1 : -1;
        previewPoint = new SheetPosition(
          previewPoint.x,
          center.y + signY * this.constrainedRadiusY,
        );
      }
    }

    store.setWorkingEllipse({
      ...we,
      previewPoint,
    });

    return { previewPoint, isCircular };
  }

  private computeCenterFromCornerMode(
    firstPoint: SheetPosition,
    secondPoint: SheetPosition,
  ): SheetPosition {
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
        lowerRight.x = firstPoint.x + this.constrainedRadiusX * 2;
      } else {
        upperLeft.x = firstPoint.x - this.constrainedRadiusX * 2;
      }
    }
    if (typeof this.constrainedRadiusY === 'number') {
      if (firstPoint.y <= secondPoint.y) {
        lowerRight.y = firstPoint.y + this.constrainedRadiusY * 2;
      } else {
        upperLeft.y = firstPoint.y - this.constrainedRadiusY * 2;
      }
    }

    return new SheetPosition((upperLeft.x + lowerRight.x) / 2, (upperLeft.y + lowerRight.y) / 2);
  }

  private computeCircularPoint(
    center: SheetPosition,
    targetPoint: SheetPosition,
    isCenterMode: boolean,
  ): SheetPosition {
    const dx = targetPoint.x - center.x;
    const dy = targetPoint.y - center.y;
    let dist = Math.max(Math.abs(dx), Math.abs(dy));
    const signX = dx >= 0 ? 1 : -1;
    const signY = dy >= 0 ? 1 : -1;

    if (typeof this.constrainedRadiusX === 'number') {
      if (isCenterMode) {
        dist = this.constrainedRadiusX;
      } else {
        dist = this.constrainedRadiusX * 2 /* radius -> diameter */;
      }
    }

    return new SheetPosition(center.x + signX * dist, center.y + signY * dist);
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

    const [radiusXConstraint, radiusYConstraint] = this.getGeometryStore().workingConstraints;
    const radiusXConstrainedLength =
      radiusXConstraint.type === 'linear' ? radiusXConstraint.constrainedLength : null;
    const radiusYConstrainedLength =
      radiusYConstraint.type === 'linear' ? radiusYConstraint.constrainedLength : null;

    if (radiusXConstrainedLength !== null || radiusYConstrainedLength !== null) {
      this.getHistoryManager().applyTransaction('create-rectangle-with-constraints', () => {
        const ellipse = this.getGeometryStore().addOrdered(
          ID_PREFIXES.ellipse,
          Ellipse.create(center, {
            radiusX,
            radiusY,
            linkDimensions: this.toolManager.getShiftHeld(),
          }),
        );
        if (radiusXConstrainedLength !== null) {
          this.getGeometryStore().addConstraint(
            LinearConstraint.create(
              ConstraintEndpoint.lockedToEllipse(ellipse.id, 'center'),
              ConstraintEndpoint.lockedToEllipse(ellipse.id, 'right'),
              radiusXConstrainedLength,
            ),
          );
        }
        if (radiusYConstrainedLength !== null) {
          this.getGeometryStore().addConstraint(
            LinearConstraint.create(
              ConstraintEndpoint.lockedToEllipse(ellipse.id, 'center'),
              ConstraintEndpoint.lockedToEllipse(ellipse.id, 'top'),
              radiusYConstrainedLength,
            ),
          );
        }
      });
    } else {
      this.getGeometryStore().addOrdered(
        ID_PREFIXES.ellipse,
        Ellipse.create(center, {
          radiusX,
          radiusY,
          linkDimensions: this.toolManager.getShiftHeld(),
        }),
      );
    }

    this.getGeometryStore().clearWorkingEllipse();
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
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}
