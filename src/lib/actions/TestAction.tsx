import React from "react";
import { BaseAction } from "./BaseAction";

export class TestAction extends BaseAction {
  get type(): string {
    return "test";
  }

  get label(): string {
    return "Test Action";
  }

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    );
  }

  get executeKeyCombo(): string {
    return "cmd+t";
  }

  execute(): void {
    alert("Hello world!");
  }
}