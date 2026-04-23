import { BaseTool } from "./BaseTool";

/** A tool for moving + scaling the viewport. */
export class MoveTool extends BaseTool {
  type = "move" as const;

  // TODO: implement this one

  getCursor(): string {
    return "grab";
  }
}
