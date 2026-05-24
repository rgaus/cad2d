import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { applySnapping, applyKeyPointSnapping } from './SnappingCalculator';
import { BaseTool } from './BaseTool';
import { LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX } from '../geometry/types';
import { distance } from '@/lib/math';
import { Length } from '@/lib/units/length';

export type ConstraintToolEvents = {
  previewSheetPositionChange: (data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null) => void;
};

/** A tool for creating constraints. */
export class ConstraintTool extends BaseTool<ConstraintToolEvents> {
  type = "constraint" as const;
  focusKeyCombo = 'c' as const;

  previewSheetPos: SheetPosition | null = null;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    if (geometryStore.workingConstraints.length === 0) {
      const gridSnapped = this.applySnapping(sheetPos);
      const endpoint = applyKeyPointSnapping(
        gridSnapped,
        this.toolManager.getShiftHeld(),
        {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          superHeld: this.toolManager.getSuperHeld(),
          viewportScale: viewport.scale,
          rectangles: geometryStore.rectangles,
          ellipses: geometryStore.ellipses,
          polygons: geometryStore.polygons,
        },
      );
      geometryStore.setWorkingConstraints([{
        type: "linear",
        pointA: endpoint,
        pointB: endpoint,
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
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(
      gridSnapped,
      this.toolManager.getShiftHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: this.getGeometryStore().rectangles,
        ellipses: this.getGeometryStore().ellipses,
        polygons: this.getGeometryStore().polygons,
      },
    );

    let isSnapped = false;
    if (keyPointEndpoint.type !== "point") {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    this.emit('previewSheetPositionChange', { position: this.previewSheetPos, isSnappedToKeyPoint: isSnapped });

    const wc = this.getGeometryStore().workingConstraints;
    if (wc.length > 0) {
      this.getGeometryStore().setWorkingConstraints((old) =>
        old.length > 0 ? [{ ...old[0], pointB: keyPointEndpoint }] : old,
      );
    }
  }

  getCursor(): string {
    return 'pointer';
  }

  private computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    const anchorPos = wc ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA) : null;

    return applySnapping(sheetPos, anchorPos, {
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

    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedA || !resolvedB) {
      return;
    }

    if (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) {
      // Don't allow creating 0 length constraints
      return;
    }

    switch (wc.type) {
      case 'linear':
        this.getGeometryStore().addConstraint({
          type: "linear",
          pointA: wc.pointA,
          pointB: wc.pointB,
          constrainedLength: wc.constrainedLength ?? Length.fromSheetUnits(sheet.defaultUnit, distance(resolvedA, resolvedB)),
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
