import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { PLATFORM_CONTROL_KEY_STRING } from "../detection";
import { ArrowDown } from "lucide-react";

export class LowerAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = "lower" as const;
  label = "Lower";
  desc = "Lower selected geometry one level";

  get icon(): React.ReactNode {
    return <ArrowDown size={20} />;
  }

  executeKeyCombo = [`${PLATFORM_CONTROL_KEY_STRING}+[`, "PageDown"];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find(p => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, polygon.renderOrder - 1);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, rectangle.renderOrder - 1);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, ellipse.renderOrder - 1);
        continue;
      }
    }
  }
}
