import EventEmitter from 'eventemitter3';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { forwardEvents } from '../events';
import { HistoryManager } from '../history/HistoryManager';
import { KeyCombo } from '../index-mapper';
import { SerializationManager } from '../serialization/SerializationManager';
import { Sheet } from '../sheet/Sheet';
import { ScreenPosition, type ViewportState } from '../viewport/types';
import { SelectionManager } from './SelectionManager';
import { ToolManager } from './ToolManager';
import { type ToolType } from './types';

type BaseToolEvents = {
  cursorChanged: (cursor: string) => void;
  tooltipVisibilityChanged: (tooltip: string | null) => void;
};

export type ToolJson = Pick<BaseTool, 'type' | 'label' | 'icon' | 'focusKeyCombo'>;

/** The base class of a tool which a user can use to interact with the sheet. */
export abstract class BaseTool<
  Events extends EventEmitter.ValidEventTypes = {},
> extends EventEmitter<Events & BaseToolEvents> {
  protected toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    super();
    this.toolManager = toolManager;
  }

  /** Returns a string used to represent the given tool. */
  abstract readonly type: ToolType;

  /** Returns the display label for this tool. */
  abstract readonly label: string;

  /** Returns the icon element for this tool. */
  abstract readonly icon: React.ReactNode;

  /** Key combo used to activate the tool. Can be multiple keys in a row. */
  readonly focusKeyCombo: KeyCombo | null = null;

  #cursor: string | null = null;

  /** Default cursor string for this tool. Subclasses override to change. */
  protected defaultCursor: string = 'default';

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

  get subToolsJSONList(): Array<ToolJson> {
    return [];
  }

  changeSubTool(_type: ToolJson['type']) {
    throw new Error(`Cannot select subtool for ${this.type}`);
  }

  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTooltipType: string | null = null;

  /** Schedules a tooltip to appear after `timeoutMs`. If a different tooltip type is already
   * pending, the old one is cancelled first. If the same type is already pending, this is a no-op. */
  protected scheduleTooltip(type: string, timeoutMs: number): void {
    if (this.pendingTooltipType !== null) {
      if (this.pendingTooltipType === type) {
        return;
      }
      this.cancelTooltip();
    }
    this.pendingTooltipType = type;
    this.tooltipTimer = setTimeout(() => {
      this.showTooltip(type);
    }, timeoutMs);
  }

  protected showTooltip(type: string | null): void {
    (this as EventEmitter).emit('tooltipVisibilityChanged', type);
  }

  /** Cancels any pending tooltip timer and emits `null`. Safe to call when no timer is active. */
  protected cancelTooltip(): void {
    if (this.tooltipTimer !== null) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
    this.pendingTooltipType = null;
    this.showTooltip(null);
  }

  /** Restarts the tooltip timer if the given `type` is currently pending. Used to reset the
   * timeout on mouse movement (e.g. for the geometry-fill tooltip). */
  protected restartTooltip(type: string, timeoutMs: number): void {
    if (this.pendingTooltipType !== type) {
      return;
    }
    const timerWasSet = this.tooltipTimer !== null;
    this.cancelTooltip();
    if (timerWasSet) {
      this.scheduleTooltip(type, timeoutMs);
    }
  }

  /** Called when a tool is selected by the user. */
  handleToolFocus(): void {}

  /** Called when a tool is de-selected by the user. */
  handleToolBlur(): void {}

  handleMouseDown(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleMouseMove(_screenPos: ScreenPosition, _viewport: ViewportState): void {}
  handleKeyDown(_event: KeyboardEvent): boolean {
    return false;
  }
  handleKeyUp(_event: KeyboardEvent): boolean {
    return false;
  }

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

  toJSON(): ToolJson {
    return {
      type: this.type,
      label: this.label,
      icon: this.icon,
      focusKeyCombo: this.focusKeyCombo,
    };
  }
}

export type BaseToolClass<Events extends EventEmitter.ValidEventTypes> = new (
  toolManager: ToolManager,
) => BaseTool<Events>;

/** The base class of a higher level wrapper tool which switches between a bunch of inner / more
 * specific tools. */
export abstract class BaseMultiTool<
  Events extends EventEmitter.ValidEventTypes = {},
> extends BaseTool<Events> {
  abstract subTools: Array<BaseToolClass<Events>>;

  private currentlyActiveIndex: number = 0;

  private constructorArgs: [ToolManager];
  constructor(actionsManager: ToolManager) {
    super(actionsManager);
    this.constructorArgs = [actionsManager];
  }

  #subToolInstances: Array<BaseTool<Events>> | null = null;
  private get subToolInstances() {
    if (this.#subToolInstances === null) {
      this.#subToolInstances = this.subTools.map((ST) => new ST(...this.constructorArgs));
    }
    return this.#subToolInstances;
  }

  get label() {
    const instance = this.subToolInstances[this.currentlyActiveIndex];
    if (!instance) {
      throw new Error(`Unknown sub action index ${this.currentlyActiveIndex}`);
    }
    return instance.label;
  }

  get icon() {
    const instance = this.subToolInstances[this.currentlyActiveIndex];
    if (!instance) {
      throw new Error(`Unknown sub action index ${this.currentlyActiveIndex}`);
    }
    return instance.icon;
  }

  get cursor() {
    const instance = this.subToolInstances[this.currentlyActiveIndex];
    if (!instance) {
      throw new Error(`Unknown sub action index ${this.currentlyActiveIndex}`);
    }
    return instance.cursor;
  }

  get subToolsJSONList(): Array<ToolJson> {
    return this.subToolInstances.map((sa) => sa.toJSON());
  }

  #forwardEventsCleanup: (() => void) | null = null;
  changeSubTool(type: ToolJson['type']) {
    const newIndex = this.subToolInstances.findIndex((instance) => instance.type === type);
    if (newIndex === -1) {
      throw new Error(`Cannot switch to subaction ${type}, not found`);
    }

    this.subToolInstances[this.currentlyActiveIndex].handleToolBlur();
    this.#forwardEventsCleanup?.();
    this.currentlyActiveIndex = newIndex;
    forwardEvents(this, this.subToolInstances[this.currentlyActiveIndex]);
    this.subToolInstances[this.currentlyActiveIndex].handleToolFocus();
  }

  handleToolFocus() {
    forwardEvents(this, this.subToolInstances[this.currentlyActiveIndex]);
    this.subToolInstances[this.currentlyActiveIndex].handleToolFocus();
  }
  handleToolBlur() {
    this.subToolInstances[this.currentlyActiveIndex].handleToolBlur();
    this.#forwardEventsCleanup?.();
  }

  handleKeyUp(event: KeyboardEvent) {
    return this.subToolInstances[this.currentlyActiveIndex].handleKeyUp(event);
  }
  handleKeyDown(event: KeyboardEvent) {
    return this.subToolInstances[this.currentlyActiveIndex].handleKeyDown(event);
  }
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    return this.subToolInstances[this.currentlyActiveIndex].handleMouseDown(screenPos, viewport);
  }
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    return this.subToolInstances[this.currentlyActiveIndex].handleMouseMove(screenPos, viewport);
  }
}
