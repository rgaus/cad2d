"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ActionMenu } from "./ActionMenu";
import { ActionsManager, ActionType } from "@/lib/actions/ActionsManager";

type ActionPanelProps = {
  actionsManager: ActionsManager;
};

const PINNED_ACTION_TYPES: Array<ActionType> = ["undo", "redo"];

export const ActionPanel: React.FunctionComponent<ActionPanelProps> = ({ actionsManager }) => {
  const [actionsJson, setActionsJson] = useState(() => actionsManager.listActionsJSON());

  const updateActionsJson = useCallback(() => {
    setActionsJson(actionsManager.listActionsJSON());
  }, [actionsManager]);

  useEffect(() => {
    actionsManager.on('actionDisabledChange', updateActionsJson);
    return () => {
      actionsManager.off('actionDisabledChange', updateActionsJson);
    };
  }, [actionsManager]);

  const pinnedActionsJson = useMemo(
    () => actionsJson.filter(a => PINNED_ACTION_TYPES.includes(a.type as ActionType)),
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
