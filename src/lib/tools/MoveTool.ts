import { BaseTool } from "./BaseTool";

/** A tool for moving + scaling the viewport. */
export class MoveTool extends BaseTool {
  type = "move" as const;
  focusKeyCombo = 'm' as const;

  // TODO: implement this one

  handleToolFocus() {
    this.toolManager.getViewportControls()?.setPanEnabled(true);
  }

  handleToolBlur() {
    this.toolManager.getViewportControls()?.setPanEnabled(false);
  }

  getCursor(): string {
    return "grab";
  }
}
