import React from "react";
import { BaseAction } from "./BaseAction";
import { PLATFORM_CONTROL_KEY_STRING } from "../detection";

export class PasteAction extends BaseAction {
  type = "paste" as const;
  label = "Paste";
  desc = "Paste geometry from clipboard";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <rect x="8" y="2" width="8" height="4" rx="1" />
      </svg>
    );
  }

  executeKeyCombo = `${PLATFORM_CONTROL_KEY_STRING}+v`;

  async execute() {
    const text = await navigator.clipboard.readText();
    this.getSerializationManager()?.loadFragment(text);
    // FIXME: select the newly added geometries
  }
}
