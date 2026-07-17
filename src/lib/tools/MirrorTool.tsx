import { SquareCenterlineDashedHorizontalIcon } from 'lucide-react';
import { Entity } from '@/lib/geometry';
import { ID_PREFIXES } from '../geometry/GeometryStore';
import { MirrorFilter } from '../geometry/filters/mirror';
import { ViewportControls } from '../viewport/ViewportControls';
import { ScreenPosition, SheetPosition, ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { applySnapping, applySnappingLineSeries } from '../snapping';

export type MirrorToolEvents = {
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

export class MirrorTool extends BaseTool<MirrorToolEvents, 'mirror'> {
  type = 'mirror' as const;
  label = 'Mirror';
  stability = 'beta' as const;
  focusKeyCombo = 'g m' as const;

  get icon(): React.ReactNode {
    return <SquareCenterlineDashedHorizontalIcon size={24} color="white" />;
  }

  private state: 'picking-geometry' | 'placing-point-a' | 'placing-point-b' = 'picking-geometry';

  private previewSheetPos: SheetPosition | null = null;

  handleToolFocus(): void {
    this.emit('previewSheetPositionChange', null);
    this.showTooltip('mirror-initial');
  }

  handleToolBlur(): void {
    this.abort();
    this.cancelTooltip();
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type !== 'mirror') {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(
      screenPos,
      geometryStore.workingFilter.pointA,
      viewport,
    );

    // Render the preview "handle" at previewSheetPos
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    // Set pointB to the preview sheet position so the working filter renders properly
    if (this.state === 'placing-point-b') {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, pointB: this.previewSheetPos });
    }
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type !== 'mirror') {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(
      screenPos,
      geometryStore.workingFilter.pointA,
      viewport,
    );
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    switch (this.state) {
      case 'picking-geometry':
        break;
      case 'placing-point-a':
        geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, pointA: this.previewSheetPos });
        this.showTooltip('mirror-place-point-b');
        this.state = 'placing-point-b';
        break;
      case 'placing-point-b':
        geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, pointB: this.previewSheetPos });
        this.complete();
        break;
    }
  }

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    prevPoint: SheetPosition | null,
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

    return prevPoint ? (
      applySnappingLineSeries(sheetPos, prevPoint, options)
    ) : applySnapping(sheetPos, options);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abort();
      return true;
    }
    return false;
  }

  handleGeometryFillEnter(geometryId: Entity['id']): void {
    this.showTooltip('mirror-geometry-hovered');
    this.highlightGeometry(geometryId);
  }

  handleGeometryFillLeave(geometryId: Entity['id']): void {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (workingFilter?.type === 'mirror' && workingFilter.geometryId === geometryId) {
      // Skip removing if this geometry is part of the working filter
      // Reset the tooltip based on the current state
      switch (this.state) {
        case 'placing-point-a':
          this.showTooltip('mirror-place-point-a');
          return;
        case 'placing-point-b':
          this.showTooltip('mirror-place-point-b');
          return;
        case 'picking-geometry':
          this.showTooltip('mirror-initial');
          return;
      }
    }

    this.showTooltip('mirror-initial');
    this.highlightGeometry(null);
  }

  handleGeometryFillPointerDown(
    _screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    geometryId: Entity['id'],
  ) {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type === 'mirror') {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, geometryId });
    } else {
      this.showTooltip('mirror-place-point-a');
      this.state = 'placing-point-a';
      geometryStore.setWorkingFilter({
        type: 'mirror',
        geometryId,
        pointA: null,
        pointB: null,
        shadowsFilterId: null,
      });
    }
    return true;
  }

  private abort() {
    this.state = 'picking-geometry';

    this.highlightGeometry(null);
    this.getGeometryStore().clearWorkingFilter();
    this.showTooltip('mirror-initial');

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private complete() {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (workingFilter?.type !== 'mirror' || !workingFilter.pointA || !workingFilter.pointB) {
      return;
    }

    this.getGeometryStore().add(
      ID_PREFIXES.filter,
      MirrorFilter.create(workingFilter.geometryId, workingFilter.pointA, workingFilter.pointB),
    );

    this.abort();
  }
}
