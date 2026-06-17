'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tool, ToolManager } from '@/lib/tools/ToolManager';
import type { ToolType } from '@/lib/tools/types';
import { cn } from '@/lib/utils';
import { KeyboardShortcut } from './KeyboardShortcut';

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
  const [popoverOpenType, setPopoverOpenType] = useState<ToolType | null>(null);

  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const handleToolChange = (tool: Tool) => {
      setActiveTool(tool);
      setPopoverOpenType(null);
      setRevision((n) => n + 1);
    };
    toolManager.on('toolChange', handleToolChange);
    return () => {
      toolManager.off('toolChange', handleToolChange);
    };
  }, [toolManager]);

  const toolsJson = useMemo(() => {
    const json = toolManager.listToolsJSON();
    return TOOL_LIST.map((toolType) => json.find((t) => t.type === toolType)).filter(
      (t) => typeof t !== 'undefined',
    );
  }, [toolManager, revision]);

  const [hoveredTool, setHoveredTool] = useState<ToolType | null>(null);

  const handlePopoverToggle = useCallback((toolType: ToolType) => {
    setPopoverOpenType((prev) => (prev === toolType ? null : toolType));
  }, []);

  useEffect(() => {
    const onMouseUp = () => {
      setPopoverOpenType(null)
    };

    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [])

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
      onMouseUp={(e) => {
        e.stopPropagation();
        e.preventDefault()
      }}
    >
      <ToggleGroup type="single" value={activeTool.type}>
        {toolsJson.map((toolJson) => {
          let shortcut: string | null = null;
          const focusKeyCombo = toolJson.activeSubTool?.focusKeyCombo ?? toolJson.focusKeyCombo;
          if (typeof focusKeyCombo === 'string') {
            shortcut = focusKeyCombo;
          } else if (Array.isArray(focusKeyCombo)) {
            shortcut = focusKeyCombo[0];
          }

          const hasSubTools = toolJson.subToolsJSONList.length > 0;
          const isPopoverOpen = popoverOpenType === toolJson.type;

          if (hasSubTools) {
            return (
              <Popover
                key={toolJson.type}
                open={isPopoverOpen}
              >
                <PopoverAnchor asChild>
                  <ToggleGroupItem
                    value={toolJson.type}
                    title={toolJson.label}
                    className="relative"
                    onMouseEnter={() => setHoveredTool(toolJson.type)}
                    onMouseLeave={() => setHoveredTool(null)}
                    onFocus={() => setHoveredTool(toolJson.type)}
                    onBlur={() => setHoveredTool(null)}
                    onMouseDown={() => {
                      if (activeTool.type === toolJson.type && popoverOpenType !== toolJson.type) {
                        handlePopoverToggle(toolJson.type);
                      } else {
                        setPopoverOpenType(null);
                        toolManager.setActiveTool(toolJson.type as ToolType);
                      }
                    }}
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
                </PopoverAnchor>
                <PopoverContent
                  side="top"
                  align="center"
                  sideOffset={10}
                  className="w-auto p-1.5 bg-[var(--slate-6)] border border-[var(--slate-7)]"
                >
                  <div className="flex gap-1">
                    {toolJson.subToolsJSONList.map((subTool) => {
                      let subShortcut: string | null = null;
                      if (typeof subTool.focusKeyCombo === 'string') {
                        subShortcut = subTool.focusKeyCombo;
                      } else if (Array.isArray(subTool.focusKeyCombo)) {
                        subShortcut = subTool.focusKeyCombo[0];
                      }

                      return (
                        <button
                          key={subTool.type}
                          type="button"
                          className={cn(
                            'w-10 h-10 rounded-[4px] flex items-center justify-center relative transition-colors',
                            'hover:bg-[var(--slate-5)]',
                          )}
                          title={subTool.label}
                          onClick={() => {
                            toolManager.changeToolSubTool(toolJson.type as ToolType, subTool.type);
                            setPopoverOpenType(null);
                          }}
                        >
                          {subTool.icon}
                          {subShortcut ? (
                            <div className="absolute -bottom-1 -right-1">
                              <KeyboardShortcut>{subShortcut}</KeyboardShortcut>
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </PopoverContent>
              </Popover>
            );
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
              onClick={() => toolManager.setActiveTool(toolJson.type as ToolType)}
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
