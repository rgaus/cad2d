import EventEmitter from 'eventemitter3';

/** The base class for an action that can be executed from the action menu. */
export abstract class BaseAction<
  Events extends EventEmitter.ValidEventTypes = {}
> extends EventEmitter<Events> {
  /** Returns a string used to represent the type of this action. */
  abstract readonly type: string;

  /** Returns the display label for this action. */
  abstract readonly label: string;

  /** Returns the icon element for this action. */
  abstract readonly icon: React.ReactNode;

  /** Key combo used to execute this action. */
  abstract readonly executeKeyCombo: string;

  /** Executes this action. */
  abstract execute(): void;
}
