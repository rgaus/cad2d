import React from "react";
import { BaseAction } from "./BaseAction";
import { pickFileToLoad } from "../file-system-helpers";
import { FolderOpen } from "lucide-react";

export class LoadAction extends BaseAction {
  type = "load" as const;
  label = "Load";
  desc = "Load drawing from SVG file";

  get icon(): React.ReactNode {
    return <FolderOpen size={20} />;
  }

  executeKeyCombo = "cmd+o";

  async execute() {
    const serializationManager = this.getSerializationManager();
    if (serializationManager === null) {
      console.warn("[cad2d] SerializationManager not registered - load skipped");
      return;
    }

    const result = await pickFileToLoad();
    if (result.content === null) {
      // User cancelled
      return;
    }

    const svg = result.content;
    const canLoadResult = serializationManager.canLoad(svg);
    if (!canLoadResult.isValid) {
      window.alert("Invalid file format - expected cad2d SVG or compatible SVG");
      return;
    }

    const loadResult = serializationManager.load(svg);
    if (!loadResult.success) {
      window.alert("Failed to load SVG - see console for details");
      return;
    }

    // If we have a file handle, store it as the last save location
    if (result.handle !== null) {
      serializationManager.setLastSaveFileHandle(result.handle);
    }

    if (loadResult.warnings.length > 0) {
      console.warn("[cad2d] Load completed with warnings:", loadResult.warnings);
    }
  }
}