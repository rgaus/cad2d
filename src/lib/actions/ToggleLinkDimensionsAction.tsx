import React from "react";
import { Link2 } from "lucide-react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { SheetPosition } from "@/lib/viewport/types";

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
    const rectangleIds = selectedIds.filter(id => geometryStore.getRectangleById(id) !== null);
    const ellipseIds = selectedIds.filter(id => geometryStore.getEllipseById(id) !== null);
    const polygonIds = selectedIds.filter(id => geometryStore.getPolygonById(id) !== null);

    // This should only be enabled if only rectangles / ellipses are selected, disabled otherwise
    const enabled = (rectangleIds.length >= 1 || ellipseIds.length >= 1) && polygonIds.length === 0;
    this.disabled = !enabled;
  }

  type = "toggle-link-dimensions" as const;
  label = "Toggle Link Dimensions";

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
        const rectangle = geometryStore.getRectangleById(id);
        if (rectangle) {
          const newLink = !rectangle.linkDimensions;
          if (newLink) {
            const w = rectangle.lowerRight.x - rectangle.upperLeft.x;
            const h = rectangle.lowerRight.y - rectangle.upperLeft.y;
            const dimension = Math.max(w, h);
            geometryStore.setRectangleLinkDimensions(rectangle.id, true);
            geometryStore.updateRectangle(rectangle.id, {
              lowerRight: new SheetPosition(
                rectangle.upperLeft.x + dimension,
                rectangle.upperLeft.y + dimension,
              ),
            });
          } else {
            geometryStore.setRectangleLinkDimensions(rectangle.id, false);
          }
          continue;
        }

        const ellipse = geometryStore.getEllipseById(id);
        if (ellipse) {
          const newLink = !ellipse.linkDimensions;
          if (newLink) {
            geometryStore.setEllipseLinkDimensions(ellipse.id, true);
            geometryStore.updateEllipse(ellipse.id, {
              radiusX: ellipse.radiusX,
              radiusY: ellipse.radiusX,
            });
          } else {
            geometryStore.setEllipseLinkDimensions(ellipse.id, false);
          }
          continue;
        }
      }
    });
  }
}
