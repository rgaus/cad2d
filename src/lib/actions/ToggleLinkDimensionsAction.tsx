import { Link2 } from 'lucide-react';
import React from 'react';
import { SheetPosition } from '@/lib/viewport/types';
import { LinkDimensionsComponent, isEllipse, isRectangle } from '../geometry';
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
    const rectangleIds = selectedIds.filter((id) => geometryStore.getRectangleById(id) !== null);
    const ellipseIds = selectedIds.filter((id) => geometryStore.getEllipseById(id) !== null);
    const polygonIds = selectedIds.filter((id) => geometryStore.getPolygonById(id) !== null);

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

        if (isRectangle(geometry)) {
          const newLink = !LinkDimensionsComponent.get(geometry);
          if (newLink) {
            const w = geometry.lowerRight.x - geometry.upperLeft.x;
            const h = geometry.lowerRight.y - geometry.upperLeft.y;
            const dimension = Math.max(w, h);
            geometryStore.setLinkDimensions(geometry.id, true);
            geometryStore.updateRectangle(geometry.id, {
              lowerRight: new SheetPosition(
                geometry.upperLeft.x + dimension,
                geometry.upperLeft.y + dimension,
              ),
            });
          } else {
            geometryStore.setLinkDimensions(geometry.id, false);
          }
          continue;
        }

        if (isEllipse(geometry)) {
          const newLink = !LinkDimensionsComponent.get(geometry);
          if (newLink) {
            geometryStore.setLinkDimensions(geometry.id, true);
            geometryStore.updateEllipse(geometry.id, {
              radiusX: geometry.radiusX,
              radiusY: geometry.radiusX,
            });
          } else {
            geometryStore.setLinkDimensions(geometry.id, false);
          }
          continue;
        }
      }
    });
  }
}
