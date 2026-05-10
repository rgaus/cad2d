import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionManager } from "./ActionManager";

export class UndoAction extends BaseAction {
  constructor(actionManager: ActionManager) {
    super(actionManager);
    this.disabled = !this.getHistoryManager().canUndo();

    this.getHistoryManager().on('stacksChange', () => {
      this.disabled = !this.getHistoryManager().canUndo();
    });
  }

  type = "undo" as const;
  label = "Undo";
  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" stroke="none" />
      </svg>
    );
  }

  executeKeyCombo = "cmd+z";
  async execute() {
    this.getHistoryManager().undo();
  }
}
