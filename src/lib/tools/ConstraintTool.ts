import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping } from './SnappingCalculator';
import { BaseTool } from './BaseTool';
import { LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX } from '../geometry/types';
import { distance } from '@/lib/math';
import { Length } from '@/lib/units/length';

export type ConstraintToolEvents = {
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

/** A tool for creating constraints. */
export class ConstraintTool extends BaseTool<ConstraintToolEvents> {
  type = "constraint" as const;
  focusKeyCombo = 'c' as const;

  previewSheetPos: SheetPosition | null = null;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.previewSheetPos = null;
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    if (geometryStore.workingConstraints.length === 0) {
      const snapped = this.applySnapping(sheetPos);
      geometryStore.setWorkingConstraints([{
        type: "linear",
        pointA: snapped,
        pointB: snapped,
        constrainedLength: null,
        connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
        disabled: false,
        shadowsConstraintId: null,
      }]);
    } else {
      this.completeConstraint();
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    this.getGeometryStore().setWorkingConstraints((old) => {
      if (old.length > 0) {
        return [{ ...old[0], pointB: this.previewSheetPos! }];
      } else {
        return old;
      }
    });
  }

  getCursor(): string {
    return 'pointer';
  }

  private computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];

    return applySnapping(sheetPos, wc?.pointA ?? null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortConstraint();
      return true;
    } else if (event.key === 'Enter' && this.previewSheetPos) {
      this.completeConstraint();
      return true;
    }
    return false;
  }

  private completeConstraint(): void {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc) {
      return;
    }

    if (wc.pointA.x == wc.pointB.x && wc.pointA.y === wc.pointB.y) {
      // Don't allow creating 0 length constraints
      return;
    }

    switch (wc.type) {
      case 'linear':
        this.getGeometryStore().addConstraint({
          type: "linear",
          pointA: wc.pointA,
          pointB: wc.pointB,
          constrainedLength: wc.constrainedLength ?? Length.fromSheetUnits(sheet.defaultUnit, distance(wc.pointA, wc.pointB)),
          connectorLineOffsetPx: -1 * wc.connectorLineOffsetPx,
        });
        break;
    }
    this.getGeometryStore().clearWorkingConstraints();

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.getGeometryStore().clearWorkingConstraints();
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
