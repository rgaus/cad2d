import EventEmitter from 'eventemitter3';
import { ScreenPosition, type ViewportState } from '../viewport/types';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { SelectionManager } from './SelectionManager';
import { HistoryManager } from '../history/HistoryManager';
import { type ToolType } from './types';
import { ToolManager } from './ToolManager';
import { SerializationManager } from '../serialization/SerializationManager';
import { KeyCombo } from '../index-mapper';
import { Sheet } from '../sheet/Sheet';

type BaseToolEvents = {
  cursorChanged: (cursor: string) => void;
};

/** The base class of a tool which a user can use to interact with the sheet. */
export abstract class BaseTool<
  Events extends EventEmitter.ValidEventTypes = {}
> extends EventEmitter<Events & BaseToolEvents> {
  protected toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    super();
    this.toolManager = toolManager;
  }

  /** Returns a string used to represent the given tool. */
  abstract readonly type: ToolType;

  /** Key combo used to activate the tool. Can be multiple keys in a row. */
  readonly focusKeyCombo: KeyCombo | null = null;

  #cursor: string | null = null;

  /** Default cursor string for this tool. Subclasses override to change. */
  protected defaultCursor: string = "default";

  /** Returns the current cursor string for this tool. */
  get cursor(): string {
    if (this.#cursor === null) {
      this.#cursor = this.defaultCursor;
    }
    return this.#cursor;
  }

  /** Sets the cursor for this tool and emits a cursorChanged event. */
  set cursor(value: string) {
    if (this.#cursor !== value) {
      this.#cursor = value;
      (this as EventEmitter).emit('cursorChanged', value);
    }
  }

  /** Called when a tool is selected by the user. */
  handleToolFocus(): void {}

  /** Called when a tool is de-selected by the user. */
  handleToolBlur(): void {}

  handleMouseDown(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleMouseMove(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleKeyDown(_event: KeyboardEvent): boolean { return false; }
  handleKeyUp(_event: KeyboardEvent): boolean { return false; }


  /** Returns the GeometryStore. */
  getGeometryStore(): GeometryStore {
    return this.toolManager.getGeometryStore();
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.toolManager.getSelectionManager();
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.toolManager.getHistoryManager();
  }

  /** Returns the SerializationManager, or null if not set. */
  getSerializationManager(): SerializationManager | null {
    return this.toolManager.getSerializationManager();
  }

  /** Returns the Sheet from the SerializationManager, or null if not set. */
  getSheet(): Sheet | null {
    return this.getSerializationManager()?.sheet ?? null;
  }
}
