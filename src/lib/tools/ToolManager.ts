import EventEmitter from 'eventemitter3';
import { getGridAtScale } from '@/lib/viewport/grid';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { SelectionManager } from './SelectionManager';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { type SnappingOptions } from '@/lib/snapping';
import { type ToolType } from './types';
import { SelectTool } from './SelectTool';
import { MoveTool } from './MoveTool';
import { PolygonTool } from './PolygonTool';
import { RectangleTool } from './RectangleTool';
import { EllipseTool } from './EllipseTool';
import { TrimSplitTool } from './TrimSplitTool';
import { ViewportControls } from '../viewport/ViewportControls';
import { BaseTool } from './BaseTool';
import { ScreenPosition, ViewportState } from '@/lib/viewport/types';
import { KeyComboDetector } from '../index-mapper';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { ConstraintTool } from './ConstraintTool';

const TOOLS = [SelectTool, MoveTool, PolygonTool, RectangleTool, EllipseTool, TrimSplitTool, ConstraintTool];
const TOOLS_BY_TYPE = {
  select: SelectTool,
  move: MoveTool,
  polygon: PolygonTool,
  rectangle: RectangleTool,
  ellipse: EllipseTool,
  'trim-split': TrimSplitTool,
  constraint: ConstraintTool,
};
export type Tool = InstanceType<(typeof TOOLS)[0]>;

export type ToolManagerEvents = {
  toolChange: (tool: Tool) => void;
  cursorChange: (cursor: string) => void;

  altChange: (altHeld: boolean) => void;
  shiftChange: (shiftHeld: boolean) => void;
  superChange: (superHeld: boolean) => void;
  ctrlChange: (ctrlHeld: boolean) => void;
};

/**
 * Manages the current tool, geometry drawing, selection, and undo/redo integration.
 * Handles input events and coordinates with GeometryStore, SelectionManager, and HistoryManager.
 */
export class ToolManager extends EventEmitter<ToolManagerEvents> {
  private tools: Array<Tool>;
  private activeToolIndex: number = 0;

  private geometryStore: GeometryStore;
  private selectionManager: SelectionManager;
  private historyManager: HistoryManager;
  snappingOptions: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>;

  private shiftHeld: boolean = false;
  private superHeld: boolean = false;
  private altHeld: boolean = false;
  private ctrlHeld: boolean = false;

  private currentViewportControls: ViewportControls | null = null;

  private keyCombos = new KeyComboDetector();

  constructor(geometryStore: GeometryStore, selectionManager: SelectionManager, historyManager: HistoryManager) {
    super();
    this.geometryStore = geometryStore;
    this.selectionManager = selectionManager;
    this.historyManager = historyManager;
    this.snappingOptions = { primaryGridSize: 1, secondaryGridSize: 0.2 };

    this.tools = TOOLS.map((ToolClass) => new ToolClass(this));

    for (const tool of this.tools) {
      this.keyCombos.registerKeyCombo(tool.focusKeyCombo);
    }
  }

  setViewportControls(viewportControls: ViewportControls) {
    this.currentViewportControls = viewportControls;
  }

  /** Gets the key which when pressed will focus a given tool. */
  getFocusKey(toolType: ToolType) {
    return this.tools.find(t => t.type === toolType)?.focusKeyCombo ?? null;
  }

  /** Changes the active tool. */
  setActiveTool(toolType: ToolType): void {
    if (this.getActiveTool().type === toolType) {
      return;
    }

    const toolIndex = this.tools.findIndex(tool => tool.type === toolType);
    if (toolIndex < 0) {
      throw new Error(`ToolManager.setTool: No tool with type ${toolType} found in tools list.`);
    }

    // Blur the old tool
    this.getActiveTool().handleToolBlur();
    (this.getActiveTool() as BaseTool).off('cursorChanged', this.forwardCursorChanged);

    this.activeToolIndex = toolIndex;
    this.emit('toolChange', this.getActiveTool());
    this.emit('cursorChange', this.getCursor());

    // Focus the new tool
    (this.getActiveTool() as BaseTool).on('cursorChanged', this.forwardCursorChanged);
    this.getActiveTool().handleToolFocus();
  }

  private forwardCursorChanged = (cursor: string) => this.emit('cursorChange', cursor);

  getTool<Type extends keyof typeof TOOLS_BY_TYPE>(type: Type) {
    return this.tools.find(
      tool => tool.type === type
    )! as InstanceType<(typeof TOOLS_BY_TYPE)[Type]>;
  }

  getActiveTool() {
    return this.tools[this.activeToolIndex];
  }

  private serializationManager: SerializationManager | null = null;

  /** Sets the SerializationManager. Optional - if not set, save/load actions will no-op. */
  setSerializationManager(manager: SerializationManager | null): void {
    this.serializationManager = manager;
  }

  /** Returns the SerializationManager, or null if not set. */
  getSerializationManager(): SerializationManager | null {
    return this.serializationManager;
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

  getViewportControls(): ViewportControls | null {
    return this.currentViewportControls;
  }

  /** Returns the current cursor string for this tool. */
  getCursor() {
    return this.getActiveTool().getCursor();
  }

  getShiftHeld() { return this.shiftHeld; }
  getSuperHeld() { return this.superHeld; }
  getAltHeld() { return this.altHeld; }
  getCtrlHeld() { return this.ctrlHeld; }

  /** Sets grid snapping options. */
  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.snappingOptions = options;
  }

  /** Syncs snapping options to the current viewport scale. */
  syncSnappingOptions(scale: number): void {
    const viewportControls = this.getViewportControls();
    const unitFamily = viewportControls ? viewportControls.getSheet().defaultUnitFamily : 'metric';
    const grid = getGridAtScale(scale, unitFamily);
    this.snappingOptions = {
      primaryGridSize: grid.primarySheetUnits,
      secondaryGridSize: grid.secondarySheetUnits,
    };
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState) {
    this.getActiveTool().handleMouseDown(screenPos, viewport);
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState) {
    this.getActiveTool().handleMouseMove(screenPos, viewport);
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Shift' && !this.shiftHeld) {
      this.shiftHeld = true;
      this.emit('shiftChange', true);
    }
    if (event.key === 'Meta' && !this.superHeld) {
      this.superHeld = true;
      this.emit('superChange', true);
    }
    if (event.key === 'Alt' && !this.altHeld) {
      this.altHeld = true;
      this.emit('altChange', true);
    }
    if (event.key === 'Control' && !this.ctrlHeld) {
      this.ctrlHeld = true;
      this.emit('ctrlChange', true);
    }

    // If a user presses a key combo to switch the active tool, then switch tools
    const toolSwitchCombo = this.keyCombos.push(event);
    if (toolSwitchCombo) {
      event.preventDefault();
      const matchingTool = this.tools.find(t => t.focusKeyCombo === toolSwitchCombo);
      if (matchingTool) {
        this.setActiveTool(matchingTool.type);
      }
      return true;
    }

    return this.getActiveTool().handleKeyDown(event);
  }

  handleKeyUp(event: KeyboardEvent) {
    if (event.key === 'Shift' && this.shiftHeld) {
      this.shiftHeld = false;
      this.emit('shiftChange', false);
    }
    if (event.key === 'Meta' && this.superHeld) {
      this.superHeld = false;
      this.emit('superChange', false);
    }
    if (event.key === 'Alt' && this.altHeld) {
      this.altHeld = false;
      this.emit('altChange', false);
    }
    if (event.key === 'Control' && this.ctrlHeld) {
      this.ctrlHeld = false;
      this.emit('ctrlChange', false);
    }

    this.getActiveTool().handleKeyUp(event);
  }
}
