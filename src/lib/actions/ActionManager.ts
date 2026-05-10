import { UndoAction } from "./UndoAction";
import { RedoAction } from "./RedoAction";
import { TestAction } from "./TestAction";
import { UnionAction } from "./UnionAction";
import { DifferenceAction } from "./DifferenceAction";
import { IntersectionAction } from "./IntersectionAction";
import { HistoryManager } from "@/lib/history/HistoryManager";
import { KeyComboDetector } from "@/lib/index-mapper";
import { GeometryStore } from "../tools/GeometryStore";
import { SelectionManager } from "../tools/SelectionManager";
import { EventEmitter } from "eventemitter3";

const ACTIONS = [UndoAction, RedoAction, TestAction, UnionAction, DifferenceAction, IntersectionAction];
const ACTIONS_BY_TYPE = {
  undo: UndoAction,
  redo: RedoAction,
  test: TestAction,
  union: UnionAction,
  difference: DifferenceAction,
  intersection: IntersectionAction,
};
export type ActionType = keyof typeof ACTIONS_BY_TYPE;
export type Action = InstanceType<(typeof ACTIONS_BY_TYPE)[ActionType]>;

export type ActionManagerEvents = {
  actionDisabledChange: (actionType: ActionType, disabled: boolean) => void;
  actionMenuOpenChange: (open: boolean) => void;
};

/** Manages the list of actions, their metadata (like disabled state, etc), and executing them. */
export class ActionManager extends EventEmitter<ActionManagerEvents> {
  private actions: Array<Action>;

  private geometryStore: GeometryStore;
  private selectionManager: SelectionManager;
  private historyManager: HistoryManager;

  private keyCombos = new KeyComboDetector();

  constructor(geometryStore: GeometryStore, selectionManager: SelectionManager, historyManager: HistoryManager) {
    super();
    this.geometryStore = geometryStore;
    this.selectionManager = selectionManager;
    this.historyManager = historyManager;

    this.actions = ACTIONS.map((ActionClass) => {
      const action = new ActionClass(this)
      action.on('disabledChange', (disabled) => this.emit('actionDisabledChange', action.type, disabled));
      return action;
    });

    this.keyCombos.registerKeyCombo("/");
    for (const action of this.actions) {
      if (typeof action.executeKeyCombo !== 'string') {
        continue;
      }
      this.keyCombos.registerKeyCombo(action.executeKeyCombo);
    }
  }

  listActionsJSON() {
    return this.actions.map(action => action.toJSON());
  }

  getAction<Type extends keyof typeof ACTIONS_BY_TYPE>(type: Type) {
    return this.actions.find(
      action => action.type === type
    )! as InstanceType<(typeof ACTIONS_BY_TYPE)[Type]>;
  }

  #actionMenuOpen = false;
  getActionMenuOpen() {
    return this.#actionMenuOpen;
  }
  closeActionMenu() {
    this.#actionMenuOpen = false;
    this.emit('actionMenuOpenChange', false);
  }
  openActionMenu() {
    this.#actionMenuOpen = true;
    this.emit('actionMenuOpenChange', true);
  }

  /** Returns the GeometryStore. */
  getGeometryStore(): GeometryStore {
    return this.geometryStore;
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.selectionManager;
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  #executingAction: Action | null = null;
  async execute(actionType: ActionType) {
    const action = this.getAction(actionType);
    this.#executingAction = action;
    await action.execute();
    this.#executingAction = null;
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    // If a user presses a key combo to switch the active tool, then switch tools
    const matchingCombo = this.keyCombos.push(event.key);
    if (matchingCombo) {
      if (matchingCombo === "/") {
        // Open the more actions menu
        this.openActionMenu();
        return true;
      }

      const matchingAction = this.actions.find(a => a.executeKeyCombo === matchingCombo);
      if (matchingAction) {
        this.execute(matchingAction.type as ActionType);
        return true;
      }
    }

    if (this.#executingAction) {
      this.#executingAction.handleKeyDown(event);
      return true;
    } else {
      return false;
    }
  }
  handleKeyUp(event: KeyboardEvent) {
    if (this.#executingAction) {
      this.#executingAction.handleKeyUp(event);
      return true;
    } else {
      return false;
    }
  }
}
