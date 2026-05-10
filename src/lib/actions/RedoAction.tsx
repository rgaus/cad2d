import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionManager } from "./ActionManager";

export class RedoAction extends BaseAction {
  constructor(actionManager: ActionManager) {
    super(actionManager);
    this.disabled = !this.getHistoryManager().canRedo();

    this.getHistoryManager().on('stacksChange', () => {
      this.disabled = !this.getHistoryManager().canRedo();
    });
  }

  type = "redo" as const;
  label = "Redo";
  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" stroke="none" />
      </svg>
    );
  }

  executeKeyCombo = "cmd+shift+z";
  async execute() {
    this.getHistoryManager().redo();
  }
}
