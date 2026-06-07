import { Link2 } from 'lucide-react';
import React from 'react';
import { SheetPosition } from '@/lib/viewport/types';
import {
  EllipseComponent,
  Geometry,
  LinkDimensionsComponent,
  PolygonComponent,
  RectangleComponent,
} from '../geometry';
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
    const rectangleIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, RectangleComponent) !== null,
    );
    const ellipseIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, EllipseComponent) !== null,
    );
    const polygonIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, PolygonComponent) !== null,
    );

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

        if (Geometry.hasComponents(geometry, RectangleComponent, LinkDimensionsComponent)) {
          const newLink = !LinkDimensionsComponent.get(geometry);
          if (newLink) {
            const rectangle = RectangleComponent.get(geometry);
            const w = rectangle.lowerRight.x - rectangle.upperLeft.x;
            const h = rectangle.lowerRight.y - rectangle.upperLeft.y;
            const dimension = Math.max(w, h);
            geometryStore.setLinkDimensions(geometry.id, true);
            geometryStore.updateById(geometry.id, (old) =>
              RectangleComponent.update(old as Geometry<RectangleComponent>, {
                lowerRight: new SheetPosition(
                  rectangle.upperLeft.x + dimension,
                  rectangle.upperLeft.y + dimension,
                ),
              }),
            );
          } else {
            geometryStore.setLinkDimensions(geometry.id, false);
          }
          continue;
        }

        if (Geometry.hasComponents(geometry, EllipseComponent, LinkDimensionsComponent)) {
          const newLink = !LinkDimensionsComponent.get(geometry as any);
          if (newLink) {
            const ellipseData = EllipseComponent.get(geometry);
            geometryStore.setLinkDimensions(geometry.id, true);
            geometryStore.updateById(geometry.id, (old) =>
              EllipseComponent.update(old as Geometry<EllipseComponent>, {
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
    });
  }
}
