import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";

export class LowerToBottomAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = "lower-to-bottom" as const;
  label = "Lower to Bottom";
  desc = "Lower selected geometry to the bottom";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M12 5v14M5 12l7 7 7-7" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  executeKeyCombo = ["cmd+shift+[", "ctrl+shift+[", "End"];

  async execute() {
    const [maxOrder] = this.getGeometryStore().getMaxRenderOrder();
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, maxOrder);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, maxOrder);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, maxOrder);
        continue;
      }
    }
  }
}
