import React from "react";
import { UnplugIcon } from "lucide-react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";

/** Toggles a single selected polygon between open and closed state. */
export class OpenClosePolygonAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.updateDisabledState();
    this.getSelectionManager().on('selectionChange', this.updateDisabledState);
  }

  private updateDisabledState = () => {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const polygonIds = selectedIds.filter(id => geometryStore.getPolygonById(id) !== null);
    const nonPolygonCount = selectedIds.length - polygonIds.length;
    this.disabled = !(polygonIds.length === 1 && nonPolygonCount === 0);
  }

  type = "open-close-polygon" as const;
  label = "Open/Close Polygon";

  get icon(): React.ReactNode {
    return <UnplugIcon size={20} />;
  }

  async execute() {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    if (selectedIds.length === 0) {
      return;
    }

    historyManager.applyTransaction('open-close-polygon', () => {
      for (const id of selectedIds) {
        const polygon = geometryStore.getPolygonById(id);
        if (polygon) {
          if (polygon.closed) {
            geometryStore.openPolygon(polygon.id);
          } else {
            geometryStore.closePolygon(polygon.id);
          }
          return;
        }
      }
    });
  }
}
