import { BaseAction } from "./BaseAction";
import { UndoAction } from "./UndoAction";
import { RedoAction } from "./RedoAction";
import { TestAction } from "./TestAction";
import { HistoryManager } from "@/lib/history/HistoryManager";

const ACTIONS: Array<BaseAction> = [];

export function initializeActions(historyManager: HistoryManager): Array<BaseAction> {
  if (ACTIONS.length > 0) {
    return ACTIONS;
  }
  ACTIONS.push(new UndoAction(historyManager));
  ACTIONS.push(new RedoAction(historyManager));
  ACTIONS.push(new TestAction());
  return ACTIONS;
}

export function getActions(): Array<BaseAction> {
  return ACTIONS;
}

export { BaseAction };
export type { HistoryManager } from "@/lib/history/HistoryManager";