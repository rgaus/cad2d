import { Grid3x3Icon } from 'lucide-react';
import { Entity } from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { PatternFilter } from '../entity/filters/pattern';
import { applySnapping } from '../snapping';
import { ViewportControls } from '../viewport/ViewportControls';
import { ScreenPosition, SheetPosition, ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';

export type PatternGridFilterToolEvents = {
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

export class PatternGridFilterTool extends BaseTool<PatternGridFilterToolEvents, 'pattern-grid'> {
  type = 'pattern-grid' as const;
  label = 'Grid Pattern';
  stability = 'beta' as const;
  focusKeyCombo = 'g g' as const;

  get icon(): React.ReactNode {
    return <Grid3x3Icon size={24} color="white" />;
  }

  private state: 'picking-geometry' | 'placing-upper-left' | 'placing-lower-right' =
    'picking-geometry';

  private previewSheetPos: SheetPosition | null = null;

  handleToolFocus(): void {
    this.emit('previewSheetPositionChange', null);
    this.showTooltip('pattern-initial');
  }

  handleToolBlur(): void {
    this.abort();
    this.cancelTooltip();
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (
      geometryStore.workingFilter?.type !== 'pattern' ||
      geometryStore.workingFilter?.mode !== 'grid'
    ) {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);

    // Render the preview "handle" at previewSheetPos
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    // Set lower right to the preview sheet position so the working filter renders properly
    if (this.state === 'placing-lower-right') {
      geometryStore.setWorkingFilter({
        ...geometryStore.workingFilter,
        lowerRight: this.previewSheetPos,
      });
    }
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (
      geometryStore.workingFilter?.type !== 'pattern' ||
      geometryStore.workingFilter?.mode !== 'grid'
    ) {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    switch (this.state) {
      case 'picking-geometry':
        break;
      case 'placing-upper-left':
        geometryStore.setWorkingFilter({
          ...geometryStore.workingFilter,
          upperLeft: this.previewSheetPos,
        });
        this.showTooltip('pattern-grid-place-lower-right');
        this.state = 'placing-lower-right';
        break;
      case 'placing-lower-right':
        geometryStore.setWorkingFilter({
          ...geometryStore.workingFilter,
          lowerRight: this.previewSheetPos,
        });
        this.complete();
        break;
    }
  }

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const options = {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    };

    return applySnapping(sheetPos, options);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abort();
      return true;
    }
    return false;
  }

  handleGeometryFillEnter(geometryId: Entity['id']): void {
    this.showTooltip('pattern-geometry-hovered');
    this.highlightGeometry(geometryId);
  }

  handleGeometryFillLeave(geometryId: Entity['id']): void {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (workingFilter?.type === 'pattern' && workingFilter.geometryId === geometryId) {
      // Skip removing if this geometry is part of the working filter
      // Reset the tooltip based on the current state
      switch (this.state) {
        case 'placing-upper-left':
          this.showTooltip('pattern-grid-place-upper-left');
          return;
        case 'placing-lower-right':
          this.showTooltip('pattern-grid-place-lower-right');
          return;
        case 'picking-geometry':
          this.showTooltip('pattern-initial');
          return;
      }
    }

    this.showTooltip('pattern-initial');
    this.highlightGeometry(null);
  }

  handleGeometryFillPointerDown(
    _screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    geometryId: Entity['id'],
  ) {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type === 'pattern') {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, geometryId });
    } else {
      this.showTooltip('pattern-grid-place-upper-left');
      this.state = 'placing-upper-left';
      geometryStore.setWorkingFilter({
        type: 'pattern',
        mode: 'grid',
        geometryId,
        upperLeft: null,
        lowerRight: null,
        shadowsFilterId: null,
      });
    }
    return true;
  }

  private abort() {
    this.state = 'picking-geometry';

    this.highlightGeometry(null);
    this.getGeometryStore().clearWorkingFilter();
    this.showTooltip('pattern-initial');

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private complete() {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (
      workingFilter?.type !== 'pattern' ||
      workingFilter.mode !== 'grid' ||
      !workingFilter.upperLeft ||
      !workingFilter.lowerRight
    ) {
      return;
    }
    const upperLeft = workingFilter.upperLeft;
    const lowerRight = workingFilter.lowerRight;

    this.getGeometryStore().add(
      ID_PREFIXES.filter,
      PatternFilter.createGrid(workingFilter.geometryId, upperLeft, lowerRight),
    );

    this.abort();
  }
}
