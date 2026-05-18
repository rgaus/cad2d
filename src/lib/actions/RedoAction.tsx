import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { Redo2 } from "lucide-react";

export class RedoAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);
    this.disabled = !this.getHistoryManager().canRedo();

    this.getHistoryManager().on('stacksChange', () => {
      this.disabled = !this.getHistoryManager().canRedo();
    });
  }

  type = "redo" as const;
  label = "Redo";
  get icon(): React.ReactNode {
    return <Redo2 size={20} />;
  }

  executeKeyCombo = "cmd+shift+z";
  async execute() {
    this.getHistoryManager().redo();
  }
}
