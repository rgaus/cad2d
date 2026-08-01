import { ChartPieIcon } from 'lucide-react';
import { Entity, GeometryComponent } from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '../entity/components/FilterComponent';
import { PatternFilter } from '../entity/filters/pattern';
import { applySnapping, applySnappingLineSeries } from '../snapping';
import { ViewportControls } from '../viewport/ViewportControls';
import { ScreenPosition, SheetPosition, ViewportState } from '../viewport/types';
import { BaseTool } from './BaseTool';

export type PatternRadialFilterToolEvents = {
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
};

export class PatternRadialFilterTool extends BaseTool<
  PatternRadialFilterToolEvents,
  'pattern-radial'
> {
  type = 'pattern-radial' as const;
  label = 'Radial Pattern';
  focusKeyCombo = 'g r' as const;

  get icon(): React.ReactNode {
    return <ChartPieIcon size={24} color="white" className="-rotate-45" />;
  }

  private state: 'picking-geometry' | 'placing-center' | 'placing-radius' = 'picking-geometry';

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
      geometryStore.workingFilter.mode !== 'radial'
    ) {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(
      screenPos,
      geometryStore.workingFilter.center,
      viewport,
    );

    switch (this.state) {
      case 'picking-geometry':
      case 'placing-center':
        // Render the preview "handle" at previewSheetPos
        this.emit('previewSheetPositionChange', this.previewSheetPos);
        break;
      case 'placing-radius':
        if (!geometryStore.workingFilter.center) {
          throw new Error(
            'PatternRadialFilterTool: in state=placing-radius, but workingFilter.center is unset, this should be impossible.',
          );
        }
        geometryStore.setWorkingFilter({
          ...geometryStore.workingFilter,
          // Set radius to the preview sheet position so the working filter renders properly
          radius: this.getRadiusFromPreviewPosition(
            geometryStore.workingFilter.center,
            this.previewSheetPos,
          ),
        });
        break;
      default:
        this.state satisfies never;
        break;
    }
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const geometryStore = this.getGeometryStore();
    if (
      geometryStore.workingFilter?.type !== 'pattern' ||
      geometryStore.workingFilter.mode !== 'radial'
    ) {
      // Geometry must be clicked first.
      return;
    }

    this.previewSheetPos = this.computePreviewSnappedPos(
      screenPos,
      geometryStore.workingFilter.center,
      viewport,
    );

    switch (this.state) {
      case 'picking-geometry':
        this.emit('previewSheetPositionChange', this.previewSheetPos);
        break;
      case 'placing-center':
        geometryStore.setWorkingFilter({
          ...geometryStore.workingFilter,
          center: this.previewSheetPos,
        });
        this.emit('previewSheetPositionChange', null);
        this.showTooltip('pattern-radial-place-radius');
        this.state = 'placing-radius';
        break;
      case 'placing-radius':
        if (!geometryStore.workingFilter.center) {
          throw new Error(
            'PatternRadialFilterTool: in state=placing-radius, but workingFilter.center is unset, this should be impossible.',
          );
        }
        geometryStore.setWorkingFilter({
          ...geometryStore.workingFilter,
          radius: this.getRadiusFromPreviewPosition(
            geometryStore.workingFilter.center,
            this.previewSheetPos,
          ),
        });
        this.complete();
        break;
    }
  }

  private getRadiusFromPreviewPosition(center: SheetPosition, previewPosition: SheetPosition) {
    return center.y - previewPosition.y;
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
      viewportScale: viewport.scale,
    };

    return prevPoint
      ? applySnappingLineSeries(sheetPos, prevPoint, options)
      : applySnapping(sheetPos, options);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abort();
      return true;
    }
    return false;
  }

  handleGeometryFillEnter(geometryId: Entity['id']): void {
    if (this.state !== 'picking-geometry') {
      return;
    }
    this.showTooltip('pattern-geometry-hovered');
    this.highlightGeometry(geometryId);
  }

  handleGeometryFillLeave(geometryId: Entity['id']): void {
    const workingFilter = this.getGeometryStore().workingFilter;
    if (workingFilter?.type === 'pattern' && workingFilter.geometryId === geometryId) {
      // Skip removing if this geometry is part of the working filter
      // Reset the tooltip based on the current state
      switch (this.state) {
        case 'placing-center':
          this.showTooltip('pattern-radial-place-center');
          return;
        case 'placing-radius':
          this.showTooltip('pattern-radial-place-radius');
          return;
        case 'picking-geometry':
          this.showTooltip('pattern-initial');
          return;
      }
    }

    if (this.state === 'picking-geometry') {
      this.showTooltip('pattern-initial');
      this.highlightGeometry(null);
    }
  }

  handleGeometryFillPointerDown(
    _screenPos: ScreenPosition,
    _viewportControls: ViewportControls,
    geometryId: Entity['id'],
  ) {
    if (this.state !== 'picking-geometry') {
      return false;
    }

    const geometryStore = this.getGeometryStore();
    if (geometryStore.workingFilter?.type === 'pattern') {
      geometryStore.setWorkingFilter({ ...geometryStore.workingFilter, geometryId });
    } else {
      this.showTooltip('pattern-radial-place-center');
      this.state = 'placing-center';
      geometryStore.setWorkingFilter({
        type: 'pattern',
        mode: 'radial',
        geometryId,
        center: null,
        radius: null,
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
      workingFilter.mode !== 'radial' ||
      !workingFilter.center ||
      !workingFilter.radius
    ) {
      return;
    }
    const center = workingFilter.center;
    const radius = workingFilter.radius;

    this.getHistoryManager().applyTransaction(
      'add-pattern-radial-filter',
      () => {
        this.getGeometryStore().add(
          ID_PREFIXES.filter,
          PatternFilter.createRadial(workingFilter.geometryId, center, radius),
        );

        // After making the filter, automatically apply / unapply the associated fill color to the
        // linked geometry
        this.getGeometryStore().updateByIdWithComponent(
          workingFilter.geometryId,
          GeometryComponent,
          (geometry) => {
            const [output, events] = FilterComponent.syncFillColor(
              geometry,
              this.getGeometryStore().findFiltersByGeometryId(geometry.id),
            );
            if (output !== geometry) {
              for (const event of events) {
                this.getHistoryManager().push(event);
              }
            }
            return output;
          },
        );
      },
      { collapseIfSingle: true },
    );

    this.abort();
  }
}
