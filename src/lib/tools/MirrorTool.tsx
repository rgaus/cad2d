import { SquareCenterlineDashedHorizontalIcon } from 'lucide-react';
import { Geometry } from '@/lib/geometry';
import { ID_PREFIXES } from '../geometry/GeometryStore';
import { MirrorFilter } from '../geometry/filters/mirror';
import { ViewportControls } from '../viewport/ViewportControls';
import { ScreenPosition, SheetPosition, ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';
import { applySnapping } from '../snapping';

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

  private previewSheetPos: SheetPosition | null = null;

  handleToolFocus(): void {
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

    const sheetPos = screenPos.toWorld(viewport).toSheet();
    this.previewSheetPos = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: false,
    });
    this.emit('previewSheetPositionChange', this.previewSheetPos);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type !== 'mirror') {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.emit('previewSheetPositionChange', this.previewSheetPos);

    if (geometryStore.workingFilter.pointA === null) {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, pointA: this.previewSheetPos });
      this.showTooltip('mirror-place-point-b');
      return;
    }

    if (geometryStore.workingFilter.pointB === null) {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, pointB: this.previewSheetPos });
      this.complete();
      return;
    }
  }

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
      this.abort();
      return true;
    }
    return false;
  }

  handleGeometryFillEnter(geometryId: Geometry['id']): void {
    this.showTooltip('mirror-geometry-hovered');
    this.highlightGeometry(geometryId);
  }

  handleGeometryFillLeave(geometryId: Geometry['id']): void {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (workingFilter?.type === 'mirror' && workingFilter.geometryId === geometryId) {
      // Skip removing if this geometry is part of the working filter
      return;
    }

    this.showTooltip('mirror-initial');
    this.highlightGeometry(null);
  }

  handleGeometryFillPointerDown(
    _screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    geometryId: Geometry['id'],
  ) {
    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type === 'mirror') {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, geometryId });
    } else {
      this.showTooltip('mirror-place-point-a');
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
