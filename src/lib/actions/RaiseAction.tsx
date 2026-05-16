import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { PLATFORM_CONTROL_KEY_STRING } from "../detection";

export class RaiseAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = "raise" as const;
  label = "Raise";
  desc = "Raise selected geometry one level";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    );
  }

  executeKeyCombo = [`${PLATFORM_CONTROL_KEY_STRING}+]`, "PageUp"];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, polygon.renderOrder + 1);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, rectangle.renderOrder + 1);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, ellipse.renderOrder + 1);
        continue;
      }
    }
  }
}
