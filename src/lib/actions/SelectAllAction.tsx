import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { ToolManager } from "../tools/ToolManager";
import { PLATFORM_CONTROL_KEY_STRING } from "../detection";
import { SquareDashedMousePointer } from "lucide-react";

export class SelectAllAction extends BaseAction {
  private toolManager: ToolManager | null = null;

  constructor(actionManager: ActionsManager) {
    super(actionManager);
  }

  /** Sets the ToolManager and initializes disabled state. */
  setToolManager(toolManager: ToolManager): void {
    this.toolManager = toolManager;

    this.updateDisabledState();

    this.toolManager.on('toolChange', () => this.updateDisabledState());
    this.getSelectionManager().on('selectionChange', () => this.updateDisabledState());
  }

  private updateDisabledState(): void {
    if (!this.toolManager) {
      this.disabled = true;
      return;
    }

    const allIds = Array.from(this.getGeometryStore().getAllGeometryIds());
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const allSelected = allIds.length > 0 && allIds.every((id: string) => selectedIds.includes(id));

    this.disabled = allSelected;
  }

  type = "select-all" as const;
  label = "Select All";
  desc = "Select all geometry on the sheet";

  get icon(): React.ReactNode {
    return <SquareDashedMousePointer size={20} />;
  }

  executeKeyCombo = `${PLATFORM_CONTROL_KEY_STRING}+a`;

  async execute() {
    if (!this.toolManager) {
      return;
    }

    this.toolManager.setActiveTool('select');

    const ids = this.getGeometryStore().getAllGeometryIds();
    this.getSelectionManager().selectAll(ids);
  }
}
