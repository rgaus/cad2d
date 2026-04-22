"use client";

import { useState, useEffect } from "react";
import FloatingPanel from "./FloatingPanel";
import { HistoryManager } from "@/lib/history/HistoryManager";

type UndoRedoPanelProps = {
  historyManager: HistoryManager;
};

export default function UndoRedoPanel({ historyManager }: UndoRedoPanelProps) {
  const [canUndo, setCanUndo] = useState(historyManager.canUndo());
  const [canRedo, setCanRedo] = useState(historyManager.canRedo());

  useEffect(() => {
    const updateState = () => {
      setCanUndo(historyManager.canUndo());
      setCanRedo(historyManager.canRedo());
    };
    historyManager.on('stacksChange', updateState);
    return () => {
      historyManager.off('stacksChange', updateState);
    };
  }, [historyManager]);

  return (
    <FloatingPanel title="History" className="min-w-[80px]">
      <div className="flex gap-2">
        <button
          onClick={() => historyManager.undo()}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="w-9 h-9 rounded-[4px] flex items-center justify-center transition-colors bg-transparent hover:bg-[#444] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <UndoIcon />
        </button>
        <button
          onClick={() => historyManager.redo()}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          className="w-9 h-9 rounded-[4px] flex items-center justify-center transition-colors bg-transparent hover:bg-[#444] disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <RedoIcon />
        </button>
      </div>
    </FloatingPanel>
  );
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
      <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z" stroke="none" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="white" className="w-5 h-5">
      <path d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z" stroke="none" />
    </svg>
  );
}
