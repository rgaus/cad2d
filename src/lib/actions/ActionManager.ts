import { BaseAction } from "./BaseAction";
import { UndoAction } from "./UndoAction";
import { RedoAction } from "./RedoAction";
import { TestAction } from "./TestAction";
import { HistoryManager } from "@/lib/history/HistoryManager";
import { KeyComboDetector } from "@/lib/index-mapper";

const ACTIONS: Array<BaseAction> = [];

let keyCombos: KeyComboDetector | null = null;

export function initializeActions(historyManager: HistoryManager): Array<BaseAction> {
  if (ACTIONS.length > 0) {
    return ACTIONS;
  }
  ACTIONS.push(new UndoAction(historyManager));
  ACTIONS.push(new RedoAction(historyManager));
  ACTIONS.push(new TestAction());

  keyCombos = new KeyComboDetector();
  keyCombos.registerKeyCombo("/");

  return ACTIONS;
}

export function getActions(): Array<BaseAction> {
  return ACTIONS;
}

export function handleKeyDown(event: KeyboardEvent): boolean {
  if (keyCombos === null) {
    return false;
  }
  const result = keyCombos.push(event.key);
  if (result === "/") {
    return true;
  }
  return false;
}

export { BaseAction };
export type { HistoryManager } from "@/lib/history/HistoryManager";