import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { TestTube2 } from "lucide-react";

export class TestAction extends BaseAction {
  type = "test" as const;
  label = "Test Action";
  get icon(): React.ReactNode {
    return <TestTube2 size={20} />;
  }

  executeKeyCombo = "t";
  async execute() {
    alert("Hello world!");

    // Testing disabling / re-enabling the tool
    // When a tool is disabled, it is grayed out and cannot be selected
    setInterval(() => {
      this.disabled = !this.disabled;
    }, 2000);
  }
}
