import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { Undo2 } from "lucide-react";

export class UndoAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);
    this.disabled = !this.getHistoryManager().canUndo();

    this.getHistoryManager().on('stacksChange', () => {
      this.disabled = !this.getHistoryManager().canUndo();
    });
  }

  type = "undo" as const;
  label = "Undo";
  get icon(): React.ReactNode {
    return <Undo2 size={20} />;
  }

  executeKeyCombo = "cmd+z";
  async execute() {
    this.getHistoryManager().undo();
  }
}
