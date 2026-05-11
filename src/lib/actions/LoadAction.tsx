import React from "react";
import { BaseAction } from "./BaseAction";
import { pickFileToLoad } from "../file-system-helpers";

export class LoadAction extends BaseAction {
  type = "load" as const;
  label = "Load";
  desc = "Load drawing from SVG file";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    );
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