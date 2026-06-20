import { RulerIcon, TriangleRightIcon } from 'lucide-react';
import { distance } from '@/lib/math';
import { applyKeyPointSnapping, applySnapping, applySnappingLineSeries } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import {
  ConstraintEndpoint,
  EllipseComponent,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
  LinearConstraint,
  PerpendicularConstraint,
  PolygonComponent,
  RectangleComponent,
} from '../geometry';
import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { BaseMultiTool, BaseTool } from './BaseTool';

export type ConstraintToolEvents = {
  previewSheetPositionChange: (
    data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null,
  ) => void;
};

/** A tool for creating linear constraints. */
export class LinearConstraintTool extends BaseTool<ConstraintToolEvents, 'linear-constraint'> {
  type = 'linear-constraint' as const;
  label = 'Linear Constraint';

  get icon(): React.ReactNode {
    return <RulerIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c l' as const;

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
      const endpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
      });
      geometryStore.setWorkingConstraints([
        {
          type: 'linear',
          pointA: endpoint,
          pointB: endpoint,
          constrainedLength: null,
          connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
          disabled: false,
          shadowsConstraintId: null,
        },
      ]);
    } else {
      this.completeConstraint();
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
      ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
      polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
    });

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
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

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    const wc = this.getGeometryStore().workingConstraints;
    if (wc.length > 0 && wc[0].type === 'linear') {
      this.getGeometryStore().setWorkingConstraints((old) =>
        old.length > 0 && old[0].type === 'linear'
          ? [{ ...old[0], pointB: keyPointEndpoint }]
          : old,
      );
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    const anchorPos = wc ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA) : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        shiftHeld: this.toolManager.getShiftHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
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

    switch (wc.type) {
      case 'linear': {
        const lwc = wc as {
          type: 'linear';
          pointA: ConstraintEndpoint;
          pointB: ConstraintEndpoint;
          constrainedLength: Length | null;
          connectorLineOffsetPx: number;
        };
        const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(lwc.pointA);
        const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(lwc.pointB);
        if (!resolvedA || !resolvedB) {
          return;
        }

        if (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) {
          // Don't allow creating 0 length constraints
          return;
        }

        this.getGeometryStore().addConstraint(
          LinearConstraint.create(
            lwc.pointA,
            lwc.pointB,
            lwc.constrainedLength ??
              Length.fromSheetUnits(sheet.defaultUnit, distance(resolvedA, resolvedB)),
            {
              connectorLineOffsetPx: -1 * lwc.connectorLineOffsetPx,
            },
          ),
        );
        break;
      }
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
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}

/** A tool for creating perpendicular constraints (center + two endpoints forming a right angle). */
export class PerpendicularConstraintTool extends BaseTool<
  ConstraintToolEvents,
  'perpendicular-constraint'
> {
  type = 'perpendicular-constraint' as const;
  label = 'Perpendicular Constraint';

  get icon(): React.ReactNode {
    return <TriangleRightIcon size={24} color="white" />;
  }

  focusKeyCombo = 'c p' as const;

  private previewSheetPos: SheetPosition | null = null;
  private state: 'idle' | 'placing-pointa' | 'placing-pointb' = 'idle';

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const gridSnapped = this.applySnapping(sheetPos);
    const endpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: geometryStore.listWithComponent(RectangleComponent),
      ellipses: geometryStore.listWithComponent(EllipseComponent),
      polygons: geometryStore.listWithComponent(PolygonComponent),
    });

    const wc = geometryStore.workingConstraints[0];

    switch (this.state) {
      case 'idle':
        // First click: set pointCenter
        geometryStore.setWorkingConstraints([
          {
            type: 'perpendicular',
            pointA: endpoint,
            pointCenter: endpoint,
            pointB: endpoint,
            disabled: false,
            shadowsConstraintId: null,
          },
        ]);
        this.state = 'placing-pointa';
        break;

      case 'placing-pointa':
        if (wc.type !== 'perpendicular') {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, not "perpendicular"`,
          );
        }
        // Second click: set pointA
        geometryStore.setWorkingConstraints([{ ...wc, pointA: endpoint }]);
        this.state = 'placing-pointb';
        break;

      case 'placing-pointb':
        if (wc.type !== 'perpendicular') {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, not "perpendicular"`,
          );
        }
        // Third click: set pointB and complete
        geometryStore.setWorkingConstraints([{ ...wc, pointB: endpoint }]);
        this.completeConstraint();
        break;
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
      ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
      polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
    });

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
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

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    switch (this.state) {
      case 'idle':
        return;

      case 'placing-pointa':
        // Only pointCenter is set, update pointA preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && old[0].type === 'perpendicular') {
            return [{ ...old[0], pointA: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;

      case 'placing-pointb':
        // pointA is set, update pointB preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && old[0].type === 'perpendicular') {
            return [{ ...old[0], pointB: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    const anchorPos = wc ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA) : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        shiftHeld: this.toolManager.getShiftHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
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
    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || wc.type !== 'perpendicular') {
      return;
    }

    const resolvedCenter = this.getGeometryStore().resolveConstraintEndpoint(wc.pointCenter);
    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedC = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedCenter || !resolvedA || !resolvedC) {
      return;
    }

    // Verify all three points are different
    if (
      (resolvedCenter.x === resolvedA.x && resolvedCenter.y === resolvedA.y) ||
      (resolvedCenter.x === resolvedC.x && resolvedCenter.y === resolvedC.y) ||
      (resolvedA.x === resolvedC.x && resolvedA.y === resolvedC.y)
    ) {
      return;
    }

    this.getGeometryStore().addConstraint(
      PerpendicularConstraint.create(wc.pointA, wc.pointCenter, wc.pointB),
    );
    this.getGeometryStore().clearWorkingConstraints();

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}

type ConstraintSubToolTypes = 'linear-constraint' | 'perpendicular-constraint';

/** A multi tool for creating all types of constraints. */
export class ConstraintTool extends BaseMultiTool<ConstraintToolEvents, ConstraintSubToolTypes, 'c'> {
  type = 'constraint' as const;

  focusKeyCombo = 'c' as const;

  subTools = [LinearConstraintTool, PerpendicularConstraintTool];
}
