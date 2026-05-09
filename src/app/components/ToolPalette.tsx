"use client";

import type { ToolType } from "@/lib/tools/types";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ToolPaletteProps = {
  activeToolType: ToolType;
  onToolChange: (tool: ToolType) => void;
};

/** Floating toolbar with tool selection icons centered at the bottom of the screen. */
export default function ToolPalette({ activeToolType, onToolChange }: ToolPaletteProps) {
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
        <ToggleGroupItem value="select" title="Select">
          <SelectIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="move" title="Move">
          <MoveIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="trim-split" title="Trim / Split">
          <MoveIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="polygon" title="Polygon">
          <PolygonIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="rectangle" title="Rectangle">
          <RectangleIcon />
        </ToggleGroupItem>
        <ToggleGroupItem value="ellipse" title="Ellipse">
          <EllipseIcon />
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

function SelectIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-6 h-6">
      <path d="M5 3l14 9-7 1-4 7z" fill="white" stroke="none" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6">
      <path d="M10 9V5a1 1 0 012 0v4h4a1 1 0 012 0v4h-2v2h-2v-2h-3v-4h4v-4h-2V9h-1z" stroke="none" />
    </svg>
  );
}

function PolygonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-6 h-6">
      <circle cx="12" cy="5" r="1.5" fill="white" stroke="none" />
      <circle cx="19" cy="9" r="1.5" fill="white" stroke="none" />
      <circle cx="19" cy="15" r="1.5" fill="white" stroke="none" />
      <circle cx="12" cy="19" r="1.5" fill="white" stroke="none" />
      <circle cx="5" cy="15" r="1.5" fill="white" stroke="none" />
      <circle cx="5" cy="9" r="1.5" fill="white" stroke="none" />
      <line x1="12" y1="5" x2="19" y2="9" />
      <line x1="19" y1="9" x2="19" y2="15" />
      <line x1="19" y1="15" x2="12" y2="19" />
      <line x1="12" y1="19" x2="5" y2="15" />
      <line x1="5" y1="15" x2="5" y2="9" />
    </svg>
  );
}

function RectangleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-6 h-6">
      <rect x="4" y="5" width="16" height="14" rx="0" />
    </svg>
  );
}

function EllipseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="w-6 h-6">
      <ellipse cx="12" cy="12" rx="8" ry="5" />
    </svg>
  );
}
