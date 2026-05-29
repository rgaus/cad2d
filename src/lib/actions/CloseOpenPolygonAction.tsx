import React from "react";
import { Unplug } from "lucide-react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";

/** Toggles a single selected polygon between open and closed state. */
export class CloseOpenPolygonAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.updateDisabledState();
    this.getSelectionManager().on('selectionChange', () => this.updateDisabledState());
  }

  private updateDisabledState(): void {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const polygonIds = selectedIds.filter(id => geometryStore.getPolygonById(id) !== null);
    const nonPolygonCount = selectedIds.length - polygonIds.length;
    this.disabled = !(polygonIds.length === 1 && nonPolygonCount === 0);
  }

  type = "close-open-polygon" as const;
  label = "Open/Close Polygon";

  get icon(): React.ReactNode {
    return <Unplug size={20} />;
  }

  async execute() {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
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
  }
}
