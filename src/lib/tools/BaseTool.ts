import EventEmitter from 'eventemitter3';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { type KeyPointSnapInfo } from '@/lib/snapping';
import { forwardEvents } from '../events';
import { HistoryManager } from '../history/HistoryManager';
import { KeyCombo, KeyComboDetector, keyComboEqual } from '../index-mapper';
import { SerializationManager } from '../serialization/SerializationManager';
import { Sheet } from '../sheet/Sheet';
import { Stability } from '../stability';
import { ScreenPosition, type ViewportState } from '../viewport/types';
import { SelectionManager } from './SelectionManager';
import { ToolManager } from './ToolManager';
import { type ToolType } from './types';

/** Controls visibility of snap hint markers sheet-wide. Usually made nullable where null = nothing
 * visible. */
export type SnapHintsVisibility = { keyPoints?: boolean };

type BaseToolEvents = {
  cursorChanged: (cursor: string) => void;
  tooltipVisibilityChanged: (tooltip: string | null) => void;
  subToolChanged: (subTool: BaseTool<{}, string>) => void;
  keyPointSnapChange: (snapInfo: KeyPointSnapInfo) => void;
  snapHintsVisibilityChange: (state: SnapHintsVisibility | null) => void;
};

export type ToolJson<Type extends string = ToolType> = Pick<
  BaseTool<{}, Type>,
  'type' | 'label' | 'icon' | 'stability' | 'focusKeyCombo' | 'subToolsJSONList'
> & { activeSubTool?: ToolJson<string> };

/** The base class of a tool which a user can use to interact with the sheet. */
export abstract class BaseTool<
  Events extends EventEmitter.ValidEventTypes = {},
  Type extends string = ToolType,
  FocusKeyComboPrefix extends string | null = null,
> extends EventEmitter<Events & BaseToolEvents> {
  protected toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    super();
    this.toolManager = toolManager;
  }

  /** Returns a string used to represent the given tool. */
  abstract readonly type: Type;

  /** Returns the display label for this tool. */
  abstract readonly label: string;

  /** Returns the icon element for this tool. */
  abstract readonly icon: React.ReactNode;

  /** Stability level of the tool. Beta tools are given a callout in the ui to make it clear they
   * are not at the same level of stability as the rest of the app. */
  readonly stability: Stability = 'production';

  /** Key combo used to activate the tool. Can be multiple keys in a row. */
  readonly focusKeyCombo:
    | (FocusKeyComboPrefix extends string
        ? `${FocusKeyComboPrefix} ${KeyCombo}` // Focus key combo must match a prefix if it is within a BaseMultiTool
        : KeyCombo)
    | null = null;

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

  get subToolsJSONList(): Array<ToolJson<string>> {
    return [];
  }
  get activeSubTool(): BaseTool<any, string> | null {
    return null;
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

  toJSON(): ToolJson<Type> {
    return {
      type: this.type,
      label: this.label,
      icon: this.icon,
      stability: this.stability,
      focusKeyCombo: this.focusKeyCombo,
      subToolsJSONList: this.subToolsJSONList,
    };
  }
}

export type BaseToolClass<
  Events extends EventEmitter.ValidEventTypes,
  Type extends string = ToolType,
  FocusKeyComboPrefix extends string | null = null,
> = new (toolManager: ToolManager) => BaseTool<Events, Type, FocusKeyComboPrefix>;

/** The base class of a higher level wrapper tool which switches between a bunch of inner / more
 * specific tools. */
export abstract class BaseMultiTool<
  Events extends EventEmitter.ValidEventTypes = {},
  SubToolType extends string = string,
  FocusKeyCombo extends string | null = null,
> extends BaseTool<Events> {
  abstract subTools: Array<BaseToolClass<Events, SubToolType, FocusKeyCombo>>;

  abstract focusKeyCombo: FocusKeyCombo;

  private currentlyActiveIndex: number = 0;

  private constructorArgs: [ToolManager];
  constructor(actionsManager: ToolManager) {
    super(actionsManager);
    this.constructorArgs = [actionsManager];
  }

  #subToolInstances: Array<BaseTool<Events, SubToolType>> | null = null;
  private get subToolInstances() {
    if (this.#subToolInstances === null) {
      this.#subToolInstances = this.subTools.map((ST) => new ST(...this.constructorArgs));
    }
    return this.#subToolInstances;
  }

  #keyCombos: KeyComboDetector | null = null;
  private get keyCombos() {
    if (!this.#keyCombos) {
      this.#keyCombos = new KeyComboDetector();
      for (const tool of this.subToolInstances) {
        if (tool.focusKeyCombo) {
          this.#keyCombos.registerKeyCombo(tool.focusKeyCombo);
        }
      }
    }
    return this.#keyCombos;
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

  get subToolsJSONList(): Array<ToolJson<SubToolType>> {
    return this.subToolInstances.map((st) => st.toJSON());
  }
  get activeSubTool(): BaseTool<Events, SubToolType> {
    return this.subToolInstances[this.currentlyActiveIndex];
  }

  #forwardEventsCleanup: (() => void) | null = null;
  changeSubTool(type: SubToolType) {
    const newIndex = this.subToolInstances.findIndex((instance) => instance.type === type);
    if (newIndex === -1) {
      throw new Error(`Cannot switch to subaction ${type}, not found`);
    }

    this.subToolInstances[this.currentlyActiveIndex].handleToolBlur();
    this.#forwardEventsCleanup?.();

    this.currentlyActiveIndex = newIndex;
    (this.emit as any)('subToolChanged', this.subToolInstances[this.currentlyActiveIndex]);

    forwardEvents(this, this.subToolInstances[this.currentlyActiveIndex]);
    this.subToolInstances[this.currentlyActiveIndex].handleToolFocus();
  }

  toJSON(): ToolJson<ToolType> {
    return {
      type: this.type,
      label: this.label,
      icon: this.icon,
      stability: this.stability,
      focusKeyCombo: this.focusKeyCombo,
      subToolsJSONList: this.subToolsJSONList,
      activeSubTool: this.subToolInstances[this.currentlyActiveIndex].toJSON(),
    };
  }

  handleToolFocus() {
    forwardEvents(this, this.subToolInstances[this.currentlyActiveIndex]);
    this.subToolInstances[this.currentlyActiveIndex].handleToolFocus();
  }
  handleToolBlur() {
    this.subToolInstances[this.currentlyActiveIndex].handleToolBlur();
    this.#forwardEventsCleanup?.();
  }

  /** Pending key-combo state indicates a prefix was consumed (e.g. "c")
   *  and the detector is waiting for the remainder of a sub-tool shortcut. */
  get hasDetectorState(): boolean {
    return this.#keyCombos !== null && this.#keyCombos.stateLength > 0;
  }

  /** Primes the internal key-combo detector with the given prefix key combo,
   *  so that subsequent key presses complete the matched sub-tool shortcut.
   *  Called by ToolManager when this multi-tool was activated by a top-level
   *  key combo that consumed the prefix. */
  primeKeyComboDetector(prefixCombo: KeyCombo): void {
    this.keyCombos.primeState(prefixCombo);
  }

  handleKeyUp(event: KeyboardEvent) {
    return this.subToolInstances[this.currentlyActiveIndex].handleKeyUp(event);
  }
  handleKeyDown(event: KeyboardEvent) {
    // Esc dismisses an open sub-tool popover (primed detector state)
    if (event.key === 'Escape' && this.hasDetectorState) {
      event.preventDefault();
      this.keyCombos.resetState();
      this.toolManager.emit('popoverCloseRequest');
      return true;
    }

    // If a user presses a key combo to switch the active tool, then switch tools
    const toolSwitchCombo = this.keyCombos.push(event);
    if (toolSwitchCombo) {
      event.preventDefault();
      const matchingTool = this.subToolInstances.find(
        (t) => t.focusKeyCombo !== null && keyComboEqual(t.focusKeyCombo, toolSwitchCombo),
      );
      if (matchingTool) {
        this.changeSubTool(matchingTool.type);
      }
      return true;
    }

    return this.subToolInstances[this.currentlyActiveIndex].handleKeyDown(event);
  }
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    return this.subToolInstances[this.currentlyActiveIndex].handleMouseDown(screenPos, viewport);
  }
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    return this.subToolInstances[this.currentlyActiveIndex].handleMouseMove(screenPos, viewport);
  }
}
