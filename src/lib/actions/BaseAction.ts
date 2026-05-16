import EventEmitter from 'eventemitter3';
import { ActionsManager } from './ActionsManager';
import { GeometryStore } from '../tools/GeometryStore';
import { SelectionManager } from '../tools/SelectionManager';
import { HistoryManager } from '../history/HistoryManager';

type BaseActionEvents = {
  disabledChange: (disabled: boolean) => void;
  executed: (actionType: string) => void;
};

export type ActionJson = Pick<BaseAction, 'type' | 'label' | 'icon' | 'disabled' | 'executeKeyCombo' | 'execute'>;

/** The base class for an action that can be executed from the action menu. */
export abstract class BaseAction<
  Events extends EventEmitter.ValidEventTypes = {}
> extends EventEmitter<Events & BaseActionEvents> {

  /** Returns a string used to represent the type of this action. */
  abstract readonly type: string;

  /** Returns the display label for this action. */
  abstract readonly label: string;

  /** Returns the icon element for this action. */
  abstract readonly icon: React.ReactNode;

  /** Key combo used to execute this action. */
  readonly executeKeyCombo: string | Array<String> | null = null;

  private actionsManager: ActionsManager;

  constructor(actionsManager: ActionsManager) {
    super();
    this.actionsManager = actionsManager;
  }

  /** Returns the GeometryStore. */
  getGeometryStore(): GeometryStore {
    return this.actionsManager.getGeometryStore();
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.actionsManager.getSelectionManager();
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.actionsManager.getHistoryManager();
  }

  /** Returns the SerializationManager, or null if not set. */
  getSerializationManager() {
    return this.actionsManager.getSerializationManager();
  }

  handleKeyDown(_event: KeyboardEvent): void {}
  handleKeyUp(_event: KeyboardEvent): void {}

  #disabled: boolean = false;
  /** Whether this action is currently disabled. */
  get disabled(): boolean {
    return this.#disabled;
  }

  /** Sets whether this action is disabled and emits a disabledChange event. */
  set disabled(value: boolean) {
    if (this.#disabled !== value) {
      this.#disabled = value;
      (this as EventEmitter).emit('disabledChange', value);
    }
  }

  /** Executes this action. */
  abstract execute(): Promise<void>;

  toJSON(): ActionJson {
    return {
      type: this.type,
      label: this.label,
      icon: this.icon,
      disabled: this.disabled,
      executeKeyCombo: this.executeKeyCombo,
      execute: this.execute.bind(this),
    };
  }
}
