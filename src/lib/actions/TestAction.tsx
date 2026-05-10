import React from "react";
import { BaseAction } from "./BaseAction";

export class TestAction extends BaseAction {
  type = "test" as const;
  label = "Test Action";
  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
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
