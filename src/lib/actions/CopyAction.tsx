import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { PLATFORM_CONTROL_KEY_STRING } from "../detection";

export class CopyAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = "copy" as const;
  label = "Copy";
  desc = "Copy selected geometry to clipboard";

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
    );
  }

  executeKeyCombo = `${PLATFORM_CONTROL_KEY_STRING}+c`;

  async execute() {
    const selectedText = this.getSerializationManager()?.formatSelectedAsFragment();
    if (typeof selectedText === 'string') {
      await navigator.clipboard.writeText(selectedText);
    }
  }
}
