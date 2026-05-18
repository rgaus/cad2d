import React from "react";
import { BaseAction } from "./BaseAction";
import { pickFileToSave, saveToHandle, triggerDownload } from "../file-system-helpers";
import { Save } from "lucide-react";

export class SaveAction extends BaseAction {
  type = "save" as const;
  label = "Save";
  desc = "Save drawing to file";

  get icon(): React.ReactNode {
    return <Save size={20} />;
  }

  executeKeyCombo = "cmd+s";

  async execute() {
    const serializationManager = this.getSerializationManager();
    if (serializationManager === null) {
      console.warn("[cad2d] SerializationManager not registered - save skipped");
      return;
    }

    const svgResult = serializationManager.save();
    if (!svgResult.success || svgResult.svg === null) {
      console.error("[cad2d] Save failed - could not generate SVG");
      return;
    }

    const svg = svgResult.svg;
    const handle = serializationManager.getLastSaveFileHandle();

    if (handle !== null) {
      // Try to write directly to the stored handle
      const success = await saveToHandle(handle, svg);
      if (success) {
        return;
      }
      // If direct write failed, log and fall through to save-as behavior
      console.error("[cad2d] Direct save failed - falling back to Save As");
    }

    // No stored handle or direct write failed - do Save As
    const result = await pickFileToSave();
    if (result.handle === null) {
      // User cancelled or error
      return;
    }

    if (result.handle !== null) {
      // File System Access API was used
      const success = await saveToHandle(result.handle, svg);
      if (!success) {
        console.error("[cad2d] Save As failed - could not write to file");
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