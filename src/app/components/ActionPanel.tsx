"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "./ActionMenu";
import { ActionsManager, ActionType } from "@/lib/actions/ActionsManager";

type ActionPanelProps = {
  actionsManager: ActionsManager;
};

// FIXME: make pinned actions configurable
export const PINNED_ACTION_TYPES: Array<ActionType> = ["load", "save", "undo", "redo"];

/** The length of time a pinned action should "flash" when executed. */
export const FLASH_DURATION_MS = 100;

export const ActionPanel: React.FunctionComponent<ActionPanelProps> = ({ actionsManager }) => {
  const [actionsJson, setActionsJson] = useState(() => actionsManager.listActionsJSON());
  const [flashingActionType, setFlashingActionType] = useState<ActionType | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateActionsJson = useCallback(() => {
    setActionsJson(actionsManager.listActionsJSON());
  }, [actionsManager]);

  const handleActionExecuted = useCallback((actionType: ActionType) => {
    if (PINNED_ACTION_TYPES.includes(actionType)) {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      setFlashingActionType(actionType);
      flashTimeoutRef.current = setTimeout(() => {
        setFlashingActionType(null);
      }, FLASH_DURATION_MS);
    }
  }, []);

  useEffect(() => {
    actionsManager.on('actionDisabledChange', updateActionsJson);
    actionsManager.on('actionExecuted', handleActionExecuted);
    return () => {
      actionsManager.off('actionDisabledChange', updateActionsJson);
      actionsManager.off('actionExecuted', handleActionExecuted);
    };
  }, [actionsManager]);

  const pinnedActionsJson = useMemo(
    () => PINNED_ACTION_TYPES.map(type => actionsJson.find(a => a.type === type)).filter(a => typeof a !== 'undefined'),
    [actionsJson],
  );

  return (
    <div
      className="fixed top-4 left-4 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
    >
      <div className="flex gap-2 items-center">
        {pinnedActionsJson.map(actionJson => {
          return (
            <Button
              key={actionJson.type}
              variant="ghost"
              size="icon"
              onClick={() => actionJson.execute()}
              disabled={actionJson.disabled}
              className={flashingActionType === actionJson.type ? "bg-[var(--teal-5)]" : undefined}
            >
              {actionJson.icon}
            </Button>
          );
        })}
        <div className="w-px h-5 bg-[var(--slate-5)]" />
        <ActionMenu actionsManager={actionsManager} />
      </div>
    </div>
  );
}
