"use client";

import type { ToolType } from "@/lib/tools/types";

type ToolPaletteProps = {
  currentTool: ToolType;
  onToolChange: (tool: ToolType) => void;
};

/** Floating toolbar with tool selection icons centered at the bottom of the screen. */
export default function ToolPalette({ currentTool, onToolChange }: ToolPaletteProps) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#333] rounded-[4px] px-2 py-2 flex gap-2"
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
    >
      <ToolButton
        tool="select"
        active={currentTool === 'select'}
        onClick={() => onToolChange('select')}
        label="Select"
      >
        <SelectIcon />
      </ToolButton>

      <ToolButton
        tool="move"
        active={currentTool === 'move'}
        onClick={() => onToolChange('move')}
        label="Move"
      >
        <MoveIcon />
      </ToolButton>

      <ToolButton
        tool="polygon"
        active={currentTool === 'polygon'}
        onClick={() => onToolChange('polygon')}
        label="Polygon"
      >
        <PolygonIcon />
      </ToolButton>
    </div>
  );
}

type ToolButtonProps = {
  tool: ToolType;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
};

function ToolButton({ active, onClick, children, label }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`w-10 h-10 rounded-[4px] flex items-center justify-center transition-colors ${
        active ? "bg-[#555]" : "bg-transparent hover:bg-[#444]"
      }`}
    >
      {children}
    </button>
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
