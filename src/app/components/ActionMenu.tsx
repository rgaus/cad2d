'use client';

import fuzzy from 'fuzzy';
import { Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ActionType, ActionsManager } from '@/lib/actions/ActionsManager';
import { ActionJson } from '@/lib/actions/BaseAction';
import { cn } from '@/lib/utils';
import { FLASH_DURATION_MS, PINNED_ACTION_TYPES } from './ActionPanel';
import { KeyboardShortcut } from './KeyboardShortcut';

type ActionMenuProps = {
  actionsManager: ActionsManager;
};

export const ActionMenu: React.FunctionComponent<ActionMenuProps> = ({ actionsManager }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [actionsJson, setActionsJson] = useState(() => actionsManager.listActionsJSON());
  const [searchQuery, setSearchQuery] = useState('');
  const [isFlashing, setIsFlashing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateActionsJson = useCallback(() => {
    setActionsJson(actionsManager.listActionsJSON());
  }, [actionsManager]);

  const handleActionExecuted = useCallback((actionType: ActionType) => {
    if (!PINNED_ACTION_TYPES.includes(actionType)) {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      setIsFlashing(true);
      flashTimeoutRef.current = setTimeout(() => {
        setIsFlashing(false);
      }, FLASH_DURATION_MS);
    }
  }, []);

  useEffect(() => {
    actionsManager.on('actionMenuOpenChange', setIsOpen);
    actionsManager.on('actionDisabledChange', updateActionsJson);
    actionsManager.on('actionExecuted', handleActionExecuted);
    return () => {
      actionsManager.off('actionMenuOpenChange', setIsOpen);
      actionsManager.off('actionDisabledChange', updateActionsJson);
      actionsManager.off('actionExecuted', handleActionExecuted);
    };
  }, [actionsManager]);

  const filteredActions = useMemo(() => {
    if (searchQuery.trim().length === 0) {
      return actionsJson;
    }
    const results = fuzzy.filter(searchQuery.replace(/^\//, ''), actionsJson, {
      extract: (action) => action.label,
    });
    return results.map((r) => r.original);
  }, [actionsJson, searchQuery]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isOpen]);

  const handleActionClick = useCallback((action: ActionJson) => {
    if (action.disabled) {
      return;
    }
    setIsOpen(false);
    setSearchQuery('');
    action.execute();
  }, []);

  const renderLabelWithHighlight = useCallback(
    (label: string) => {
      if (searchQuery.trim().length === 0) {
        return <span>{label}</span>;
      }
      const matchResult = fuzzy.match(searchQuery, label, {
        pre: '<span style="color: var(--teal-8)">',
        post: '</span>',
      });
      if (matchResult && matchResult.rendered) {
        return <span dangerouslySetInnerHTML={{ __html: matchResult.rendered }} />;
      }
      return <span>{label}</span>;
    },
    [searchQuery],
  );

  const handleKeyDownInput = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Escape':
          setIsOpen(false);
          break;
        case 'Enter':
          const first = filteredActions[0];
          if (first && !first.disabled) {
            handleActionClick(first);
            setSearchQuery('');
          }
          break;
      }
    },
    [filteredActions, handleActionClick],
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Button
        asChild
        variant="ghost"
        size="icon"
        title="Actions"
        className={cn('relative', isFlashing ? 'bg-[var(--teal-5)]' : undefined)}
      >
        <PopoverTrigger
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onFocus={() => setIsHovered(true)}
          onBlur={() => setIsHovered(false)}
        >
          <Menu size={20} color="var(--slate-11)" />
          <div className={cn('absolute -bottom-1 -right-1 hidden', { block: isHovered })}>
            <KeyboardShortcut>/</KeyboardShortcut>
          </div>
        </PopoverTrigger>
      </Button>
      <PopoverContent
        className="p-1"
        align="start"
        // Keep these events from propagating and effecting the viewport state at all
        onKeyDown={(e) => e.stopPropagation()} // (For action menu search box)
        onWheel={(e) => e.stopPropagation()} // (For action menu scroll)
      >
        <div className="px-1 py-1.5 border-b border-[var(--slate-5)]">
          <Input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search actions..."
            onKeyDown={handleKeyDownInput}
          />
        </div>

        <div className="overflow-y-auto max-h-[256px]">
          {filteredActions.length === 0 ? (
            <div
              className="py-2 px-1 text-center text-sm select-none"
              style={{ color: 'var(--slate-7)', fontFamily: 'var(--font-roboto-mono), monospace' }}
            >
              No actions found
            </div>
          ) : (
            filteredActions.map((action) => (
              <Button
                key={action.type}
                type="button"
                variant="ghost"
                onClick={() => handleActionClick(action)}
                disabled={action.disabled}
                className={cn(
                  'w-full flex items-center gap-3 cursor-default select-none rounded-[4px] py-1.5 px-1 text-sm outline-none',
                  'border border-transparent',
                  'focus:bg-[var(--slate-4)] focus:text-[var(--slate-12)] focus:border-[var(--slate-8)]',
                  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                  !action.disabled && 'hover:bg-[var(--slate-4)]',
                )}
                style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
              >
                <span style={{ color: 'var(--slate-11)' }}>{action.icon}</span>
                <span className="flex-1 text-left" style={{ color: 'var(--slate-12)' }}>
                  {renderLabelWithHighlight(action.label)}
                </span>
                {typeof action.executeKeyCombo === 'string' ? (
                  <KeyboardShortcut>{action.executeKeyCombo}</KeyboardShortcut>
                ) : null}
                {Array.isArray(action.executeKeyCombo) ? (
                  <KeyboardShortcut>{action.executeKeyCombo[0]}</KeyboardShortcut>
                ) : null}
              </Button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

ActionMenu.displayName = 'ActionMenu';
