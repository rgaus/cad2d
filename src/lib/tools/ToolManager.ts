import EventEmitter from 'eventemitter3';
import { type ViewportState } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { PolygonStore } from './PolygonStore';
import { SelectionManager } from './SelectionManager';
import { HistoryManager } from '../history/HistoryManager';
import { type SnappingOptions } from './SnappingCalculator';
import type { ToolType, Id } from './types';
import { SelectTool } from './SelectTool';
import { MoveTool } from './MoveTool';
import { PolygonTool } from './PolygonTool';

const TOOLS = [SelectTool, MoveTool, PolygonTool];
const TOOLS_BY_TYPE = {
  select: SelectTool,
  move: MoveTool,
  polygon: PolygonTool,
};
export type Tool = InstanceType<(typeof TOOLS)[0]>;

/** Events emitted by ToolManager. */
export type ToolManagerEvents = {
  toolChange: (tool: Tool) => void;
  cursorChange: (cursor: string) => void;
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
  dragStateChange: (draggingPolygonId: Id | null) => void;
};

/**
 * Manages the current tool, polygon drawing, selection, and undo/redo integration.
 * Handles input events and coordinates with PolygonStore, SelectionManager, and HistoryManager.
 */
export class ToolManager extends EventEmitter<ToolManagerEvents> {
  private tools: Array<Tool>;
  private activeToolIndex: number = 0;

  private polygonStore: PolygonStore;
  private selectionManager: SelectionManager;
  private historyManager: HistoryManager;
  snappingOptions: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>;

  private currentViewportState: ViewportState | null = null;

  constructor(polygonStore: PolygonStore, selectionManager: SelectionManager, historyManager: HistoryManager) {
    super();
    this.tools = TOOLS.map((ToolClass) => new ToolClass(this));

    this.polygonStore = polygonStore;
    this.selectionManager = selectionManager;
    this.historyManager = historyManager;
    this.snappingOptions = { primaryGridSize: 1, secondaryGridSize: 0.2 };
  }

  /** Updates the current viewport state. Called by the renderer whenever the viewport changes (pan/zoom). */
  setViewportState(viewport: ViewportState): void {
    this.currentViewportState = viewport;
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

    this.activeToolIndex = toolIndex;
    this.emit('toolChange', this.getActiveTool());
    this.emit('cursorChange', this.getCursor());

    // Focus the new tool
    this.getActiveTool().handleToolFocus();
  }

  getTool<Type extends keyof typeof TOOLS_BY_TYPE>(type: Type) {
    return this.tools.find(
      tool => tool.type === type
    )! as InstanceType<(typeof TOOLS_BY_TYPE)[Type]>;
  }

  getActiveTool() {
    return this.tools[this.activeToolIndex];
  }

  /** Returns the PolygonStore. */
  getPolygonStore(): PolygonStore {
    return this.polygonStore;
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.selectionManager;
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  /** Returns the current cursor string for this tool. */
  getCursor() {
    return this.getActiveTool().getCursor();
  }

  /** Sets grid snapping options. */
  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.snappingOptions = options;
  }

  /** Syncs snapping options to the current viewport scale. */
  syncSnappingOptions(scale: number): void {
    const grid = getGridAtScale(scale);
    this.snappingOptions = {
      primaryGridSize: grid.primaryCm,
      secondaryGridSize: grid.secondaryCm,
    };
  }
}

