import React from "react";
import { BaseAction } from "./BaseAction";
import { pickFileToSave, saveToHandle, triggerDownload } from "../file-system-helpers";

export class SaveAsAction extends BaseAction {
  type = "save-as" as const;
  label = "Save As...";
  desc = "Save drawing to a new file";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </svg>
    );
  }

  executeKeyCombo = "cmd+shift+s";

  async execute() {
    const serializationManager = this.getSerializationManager();
    if (serializationManager === null) {
      console.warn("[cad2d] SerializationManager not registered - save-as skipped");
      return;
    }

    const svgResult = serializationManager.save();
    if (!svgResult.success || svgResult.svg === null) {
      console.error("[cad2d] Save-as failed - could not generate SVG");
      return;
    }

    const svg = svgResult.svg;

    // Always show picker (SaveAs behavior)
    const result = await pickFileToSave();
    if (result.handle === null && !result.usedFallback) {
      // User cancelled
      return;
    }

    if (result.handle !== null) {
      // File System Access API was used
      const success = await saveToHandle(result.handle, svg);
      if (!success) {
        console.error("[cad2d] Save-as failed - could not write to file");
        return;
      }
      serializationManager.setLastSaveFileHandle(result.handle);
    } else {
      // Fallback was used (a[download])
      triggerDownload(svg, 'drawing.svg');
      serializationManager.setLastSaveFileHandle(null);
    }
  }
}