import EventEmitter from 'eventemitter3';

type BaseActionEvents = {
  disabledChange: (disabled: boolean) => void;
};

/** The base class for an action that can be executed from the action menu. */
export abstract class BaseAction extends EventEmitter {
  private _disabled: boolean = false;

  /** Returns a string used to represent the type of this action. */
  abstract readonly type: string;

  /** Returns the display label for this action. */
  abstract readonly label: string;

  /** Returns the icon element for this action. */
  abstract readonly icon: React.ReactNode;

  /** Key combo used to execute this action. */
  abstract readonly executeKeyCombo: string;

  /** Whether this action is currently disabled. */
  get disabled(): boolean {
    return this._disabled;
  }

  /** Sets whether this action is disabled and emits a disabledChange event. */
  set disabled(value: boolean) {
    if (this._disabled !== value) {
      this._disabled = value;
      this.emit('disabledChange', value);
    }
  }

  /** Executes this action. */
  abstract execute(): void;
}

export type { BaseActionEvents };