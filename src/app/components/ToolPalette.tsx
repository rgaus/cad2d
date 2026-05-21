"use client";

import type { ToolType } from "@/lib/tools/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { PocketKnifeIcon, EllipseIcon, SquareIcon, HexagonIcon, MoveIcon, MousePointer2Icon, RulerIcon } from "lucide-react";

type ToolPaletteProps = {
  activeToolType: ToolType;
  getFocusKey: (tool: ToolType) => string | null;
  onToolChange: (tool: ToolType) => void;
};

/** Floating toolbar with tool selection icons centered at the bottom of the screen. */
export default function ToolPalette({ activeToolType, getFocusKey, onToolChange }: ToolPaletteProps) {
  const [hoveredTool, setHoveredTool] = useState<ToolType | null>(null);
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
    >
      <ToggleGroup type="single" value={activeToolType} onValueChange={(value) => {
        if (value) {
          onToolChange(value as ToolType);
        }
      }}>
        <ToggleGroupItem
          value="select"
          title="Select"
          className="relative"
          onMouseEnter={() => setHoveredTool("select")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("select")}
          onBlur={() => setHoveredTool(null)}
        >
          <MousePointer2Icon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "select" || hoveredTool === "select" })}>
            <KeyboardShortcut>{getFocusKey("select")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="move"
          title="Move"
          className="relative"
          onMouseEnter={() => setHoveredTool("move")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("move")}
          onBlur={() => setHoveredTool(null)}
        >
          <MoveIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "move" || hoveredTool === "move" })}>
            <KeyboardShortcut>{getFocusKey("move")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="trim-split"
          title="Trim / Split"
          className="relative"
          onMouseEnter={() => setHoveredTool("trim-split")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("trim-split")}
          onBlur={() => setHoveredTool(null)}
        >
          <PocketKnifeIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "trim-split" || hoveredTool === "trim-split" })}>
            <KeyboardShortcut>{getFocusKey("trim-split")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="constraint"
          title="Constraint"
          className="relative"
          onMouseEnter={() => setHoveredTool("constraint")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("constraint")}
          onBlur={() => setHoveredTool(null)}
        >
          <RulerIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "constraint" || hoveredTool === "constraint" })}>
            <KeyboardShortcut>{getFocusKey("constraint")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="polygon"
          title="Polygon"
          className="relative"
          onMouseEnter={() => setHoveredTool("polygon")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("polygon")}
          onBlur={() => setHoveredTool(null)}
        >
          <HexagonIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "polygon" || hoveredTool === "polygon" })}>
            <KeyboardShortcut>{getFocusKey("polygon")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="rectangle"
          title="Rectangle"
          className="relative"
          onMouseEnter={() => setHoveredTool("rectangle")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("rectangle")}
          onBlur={() => setHoveredTool(null)}
        >
          <SquareIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "rectangle" || hoveredTool === "rectangle" })}>
            <KeyboardShortcut>{getFocusKey("rectangle")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
        <ToggleGroupItem
          value="ellipse"
          title="Ellipse"
          className="relative"
          onMouseEnter={() => setHoveredTool("ellipse")}
          onMouseLeave={() => setHoveredTool(null)}
          onFocus={() => setHoveredTool("ellipse")}
          onBlur={() => setHoveredTool(null)}
        >
          <EllipseIcon size={24} color="white" />
          <div className={cn("absolute -bottom-1 -right-1 hidden", { "block": activeToolType === "ellipse" || hoveredTool === "ellipse" })}>
            <KeyboardShortcut>{getFocusKey("ellipse")}</KeyboardShortcut>
          </div>
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
