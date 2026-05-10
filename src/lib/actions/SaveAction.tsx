import React from "react";
import { BaseAction } from "./BaseAction";

export class SaveAction extends BaseAction {
  type = "save" as const;
  label = "Save";
  desc = "Save drawing to SVG file (logs to console for now)";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    );
  }

  executeKeyCombo = "cmd+s";

  async execute() {
    const serializationManager = this.getSerializationManager();
    if (serializationManager === null) {
      console.warn("[cad2d] SerializationManager not registered - save skipped");
      return;
    }

    const result = serializationManager.save();
    if (!result.success || result.svg === null) {
      console.error("[cad2d] Save failed");
      return;
    }

    console.log("=== CAD2D SAVE ===");
    console.log(result.svg);
    console.log("=== END CAD2D SAVE ===");
  }
}
