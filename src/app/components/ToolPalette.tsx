'use client';

import { CheckIcon, ChevronDownIcon } from 'lucide-react';
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
  'edit',
  'constraint',
  'polygon',
  'rectangle',
  'ellipse',
];

/**
 * Extracts a single display string from a focus key combo, which may come back
 * as a plain string, an array of strings (aliases), or be absent entirely.
 */
function getShortcutLabel(focusKeyCombo: string | Array<string> | null): string | null {
  if (typeof focusKeyCombo === 'string') {
    return focusKeyCombo;
  } else if (Array.isArray(focusKeyCombo)) {
    return focusKeyCombo[0];
  } else {
    return null;
  }
}

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
    const handleSubToolChange = (tool: Tool) => {
      setActiveTool(tool);
      setPopoverOpenType(null);
      setRevision((n) => n + 1);
    };
    const handlePopoverOpenRequest = (toolType: ToolType) => {
      setPopoverOpenType(toolType);
    };
    const handlePopoverCloseRequest = () => {
      setPopoverOpenType(null);
    };
    toolManager.on('toolChange', handleToolChange);
    toolManager.on('subToolChange', handleSubToolChange);
    toolManager.on('popoverOpenRequest', handlePopoverOpenRequest);
    toolManager.on('popoverCloseRequest', handlePopoverCloseRequest);
    return () => {
      toolManager.off('toolChange', handleToolChange);
      toolManager.off('subToolChange', handleSubToolChange);
      toolManager.off('popoverOpenRequest', handlePopoverOpenRequest);
      toolManager.off('popoverCloseRequest', handlePopoverCloseRequest);
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
      setPopoverOpenType(null);
    };

    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
      onMouseUp={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <ToggleGroup type="single" value={activeTool.type}>
        {toolsJson.map((toolJson) => {
          const focusKeyCombo = toolJson.activeSubTool?.focusKeyCombo ?? toolJson.focusKeyCombo;
          const shortcut = getShortcutLabel(focusKeyCombo);

          const hasSubTools = toolJson.subToolsJSONList.length > 0;
          const isPopoverOpen = popoverOpenType === toolJson.type;

          const stabilityTag =
            toolJson.stability !== 'production' ? (
              <div
                className={cn('absolute -top-1 -right-1 hidden', {
                  block: activeTool.type === toolJson.type || hoveredTool === toolJson.type,
                })}
              >
                <span
                  className="rounded-sm px-1"
                  style={{
                    backgroundColor: 'var(--purple-5)',
                    border: '1px solid var(--purple-8)',
                    color: '#cccccc',
                    fontSize: 7,
                    opacity: 1,
                  }}
                >
                  beta
                </span>
              </div>
            ) : null;

          if (hasSubTools) {
            return (
              <Popover key={toolJson.type} open={isPopoverOpen}>
                <PopoverAnchor asChild>
                  <ToggleGroupItem
                    value={toolJson.type}
                    title={toolJson.label}
                    className="w-auto pr-1"
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
                    <div className="relative flex items-center justify-center w-10 h-10 grow-0 shrink-0">
                      {toolJson.icon}
                      {stabilityTag}
                      {shortcut ? (
                        <div
                          className={cn('absolute -bottom-1 -right-1 hidden', {
                            block:
                              activeTool.type === toolJson.type || hoveredTool === toolJson.type,
                          })}
                        >
                          <KeyboardShortcut>{shortcut}</KeyboardShortcut>
                        </div>
                      ) : null}
                    </div>
                    <ChevronDownIcon className="w-3.5 h-3.5" />
                  </ToggleGroupItem>
                </PopoverAnchor>
                {/*
                  Vertical menu list matching the Figma tool-group popover:
                  a reserved checkmark column, icon, label, and a right-aligned
                  shortcut, all left-anchored above the trigger button.
                */}
                <PopoverContent
                  side="top"
                  align="start"
                  sideOffset={10}
                  className="w-auto min-w-[180px] p-1 bg-[var(--slate-6)] border border-[var(--slate-7)] rounded-[4px]"
                >
                  <div className="flex flex-col gap-0.5">
                    {toolJson.subToolsJSONList.map((subTool) => {
                      const subShortcut = getShortcutLabel(subTool.focusKeyCombo);
                      const isActiveSubTool = toolJson.activeSubTool?.type === subTool.type;

                      return (
                        <button
                          key={subTool.type}
                          type="button"
                          className={cn(
                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-[4px] text-left transition-colors',
                            'hover:bg-[var(--slate-5)]',
                          )}
                          title={subTool.label}
                          onClick={() => {
                            toolManager.changeToolSubTool(toolJson.type as ToolType, subTool.type);
                            setPopoverOpenType(null);
                          }}
                        >
                          {/* Checkmark column - reserves space whether active or not, so icons/labels stay aligned across rows */}
                          <span className="flex w-3.5 h-3.5 items-center justify-center shrink-0 text-[var(--slate-12)]">
                            {isActiveSubTool ? <CheckIcon className="w-3.5 h-3.5" /> : null}
                          </span>
                          {/* Icon column */}
                          <span className="flex w-4 h-4 items-center justify-center shrink-0 text-[var(--slate-12)]">
                            {subTool.icon}
                          </span>
                          <span
                            className="text-sm text-[var(--slate-12)] whitespace-nowrap"
                            style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
                          >
                            {subTool.label}
                          </span>
                          {subTool.stability !== 'production' ? (
                            <span
                              className="rounded-sm px-1"
                              style={{
                                backgroundColor: 'var(--purple-5)',
                                border: '1px solid var(--purple-8)',
                                color: '#cccccc',
                                fontSize: 9,
                                opacity: 1,
                              }}
                            >
                              beta
                            </span>
                          ) : null}
                          {subShortcut ? (
                            <span className="ml-auto pl-4 text-xs text-[var(--slate-11)]">
                              <KeyboardShortcut>{subShortcut}</KeyboardShortcut>
                            </span>
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
              {stabilityTag}
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
