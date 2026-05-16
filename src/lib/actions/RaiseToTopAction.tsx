import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";

export class RaiseToTopAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = "raise-to-top" as const;
  label = "Raise to Top";
  desc = "Raise selected geometry to the top";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M12 19V3M5 5l7-7 7 7" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  executeKeyCombo = ["cmd+shift+]", "ctrl+shift+]", "Home"];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, 0);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, 0);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, 0);
        continue;
      }
    }
  }
}