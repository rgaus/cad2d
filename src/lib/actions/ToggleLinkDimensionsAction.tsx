import { Link2 } from 'lucide-react';
import React from 'react';
import { Entity, GeometryComponent, LinkDimensionsComponent } from '@/lib/entity';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

/** Toggles the "link dimensions" flag on a single selected rectangle or ellipse.
 *
 * When linking is turned ON for a rectangle, both W and H are set to max(W, H).
 * When linking is turned ON for an ellipse, RY is set equal to RX. */
export class ToggleLinkDimensionsAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.updateDisabledState();
    this.getSelectionManager().on('selectionChange', this.updateDisabledState);
  }

  private updateDisabledState = () => {
    const selectedIds = this.getSelectionManager().getSelectedIds();

    const geometryStore = this.getGeometryStore();
    const rectangleIds = selectedIds.filter((id) => {
      const g = geometryStore.getByIdWithComponent(id, GeometryComponent);
      return g !== null && GeometryComponent.get(g).type === 'rectangle';
    });
    const ellipseIds = selectedIds.filter((id) => {
      const g = geometryStore.getByIdWithComponent(id, GeometryComponent);
      return g !== null && GeometryComponent.get(g).type === 'ellipse';
    });
    const polygonIds = selectedIds.filter((id) => {
      const g = geometryStore.getByIdWithComponent(id, GeometryComponent);
      return g !== null && GeometryComponent.get(g).type === 'polygon';
    });

    // This should only be enabled if only rectangles / ellipses are selected, disabled otherwise
    const enabled = (rectangleIds.length >= 1 || ellipseIds.length >= 1) && polygonIds.length === 0;
    this.disabled = !enabled;
  };

  type = 'toggle-link-dimensions' as const;
  label = 'Toggle Link Dimensions';

  get icon(): React.ReactNode {
    return <Link2 size={20} />;
  }

  async execute() {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    if (selectedIds.length === 0) {
      // Bail out early if nothing is selected.
      return;
    }

    historyManager.applyTransaction('toggle-link-dimensions', () => {
      for (const id of selectedIds) {
        const geometry = geometryStore.getById(id);
        if (!geometry) {
          continue;
        }

        if (
          Entity.hasComponent(geometry, GeometryComponent) &&
          Entity.hasComponent(geometry, LinkDimensionsComponent)
        ) {
          const geomData = GeometryComponent.get(geometry as Entity<GeometryComponent>);

          if (geomData.type === 'rectangle') {
            const rectData = geomData;
            const newLink = !LinkDimensionsComponent.get(geometry);
            if (newLink) {
              const w = rectData.lowerRight.x - rectData.upperLeft.x;
              const h = rectData.lowerRight.y - rectData.upperLeft.y;
              const dimension = Math.max(w, h);
              geometryStore.setLinkDimensions(geometry.id, true);
              geometryStore.updateById(geometry.id, (old) =>
                GeometryComponent.update(old as Entity<GeometryComponent<RectangleData>>, {
                  lowerRight: new SheetPosition(
                    rectData.upperLeft.x + dimension,
                    rectData.upperLeft.y + dimension,
                  ),
                }),
              );
            } else {
              geometryStore.setLinkDimensions(geometry.id, false);
            }
            continue;
          }

          if (geomData.type === 'ellipse') {
            const ellipseData = geomData;
            const newLink = !LinkDimensionsComponent.get(geometry);
            if (newLink) {
              geometryStore.setLinkDimensions(geometry.id, true);
              geometryStore.updateById(geometry.id, (old) =>
                GeometryComponent.update(old as Entity<GeometryComponent<EllipseData>>, {
                  radiusX: ellipseData.radiusX,
                  radiusY: ellipseData.radiusX,
                }),
              );
            } else {
              geometryStore.setLinkDimensions(geometry.id, false);
            }
            continue;
          }
        }
      }
    });
  }
}
