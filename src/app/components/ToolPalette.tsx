'use client';

import { useEffect, useMemo, useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { ToolType } from '@/lib/tools/types';
import { cn } from '@/lib/utils';
import { KeyboardShortcut } from './KeyboardShortcut';
import { ToolManager } from '@/lib/tools/ToolManager';

type ToolPaletteProps = {
  toolManager: ToolManager;
};

const TOOL_LIST: Array<ToolType> = [
  'select',
  'move',
  'trim-split',
  'constraint',
  'polygon',
  'rectangle',
  'ellipse',
];

/** Floating toolbar with tool selection icons centered at the bottom of the screen. */
export default function ToolPalette({ toolManager }: ToolPaletteProps) {
  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  useEffect(() => {
    toolManager.on('toolChange', setActiveTool);
    return () => {
      toolManager.off('toolChange', setActiveTool);
    };
  }, [toolManager]);

  const toolsJson = useMemo(() => {
    const json = toolManager.listToolsJSON();
    return TOOL_LIST.map((toolType) => json.find((t) => t.type === toolType)).filter((t) => typeof t !== 'undefined');
  }, [toolManager]);

  const [hoveredTool, setHoveredTool] = useState<ToolType | null>(null);
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
    >
      <ToggleGroup
        type="single"
        value={activeTool.type}
        onValueChange={(value) => {
          if (value) {
            toolManager.setActiveTool(value as ToolType);
          }
        }}
      >
        {toolsJson.map((toolJson) => {
          let shortcut: string | null = null;
          if (typeof toolJson.focusKeyCombo === 'string') {
            shortcut = toolJson.focusKeyCombo;
          } else if (Array.isArray(toolJson.focusKeyCombo)) {
            shortcut = toolJson.focusKeyCombo[0];
          }

          return (
            <ToggleGroupItem
              key={toolJson.type}
              value={toolJson.type}
              title={toolJson.label}
              className="relative"
              onMouseEnter={() => setHoveredTool(toolJson.type)}
              onMouseLeave={() => setHoveredTool(null)}
              onFocus={() => setHoveredTool(toolJson.type)}
              onBlur={() => setHoveredTool(null)}
            >
              {toolJson.icon}
              {shortcut ? (
                <div
                  className={cn('absolute -bottom-1 -right-1 hidden', {
                    block: activeTool.type === toolJson.type || hoveredTool === toolJson.type,
                  })}
                >
                  <KeyboardShortcut>{shortcut}</KeyboardShortcut>
                </div>
              ) : null}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </div>
  );
}
