import type { ActionsManager } from '../actions/ActionsManager';
import type { ToolType } from '../tools/types';
import type { Sheet } from '../sheet/Sheet';
import { serializeEllipse, serializePolygon, serializeRectangle, serializeToSvg } from './serialize';
import { parseSvg, canLoad as canLoadSvg} from './deserialize';
import { ToolManager } from '../tools/ToolManager';
import { ID_PREFIXES } from '../tools/GeometryStore';

/** Result of a save operation. */
export type SaveResult = {
  success: boolean;
  svg: string | null;
};

/** Result of a load operation. */
export type LoadResult = {
  success: boolean;
  warnings: Array<string>;
};

/** Checks if an SVG string can be loaded. */
export type CanLoadResult = {
  isValid: boolean;
  version: number | null;
  isFallback: boolean;
};

/**
 * Manages serialization and deserialization of the cad2d application state.
 * Provides save/load functionality for the full system state including geometry,
 * viewport, history, and active tool.
 * 
 * This class is optional - if not registered with ActionsManager, save/load actions
 * will gracefully no-op. This allows the system to work without serialization in
 * contexts like tests.
 */
export class SerializationManager {
  private actionsManager: ActionsManager;
  private toolManager: ToolManager;
  private getSheet: () => Sheet;
  private lastSaveFileHandle: FileSystemFileHandle | null = null;

  constructor(actionsManager: ActionsManager, toolManager: ToolManager, getSheet: () => Sheet) {
    this.actionsManager = actionsManager;
    this.toolManager = toolManager;
    this.getSheet = getSheet;
  }

  /** Returns the last saved file handle, or null if none. */
  getLastSaveFileHandle(): FileSystemFileHandle | null {
    return this.lastSaveFileHandle;
  }

  /** Sets the last saved file handle. Pass null to clear (e.g., when fallback download was used). */
  setLastSaveFileHandle(handle: FileSystemFileHandle | null): void {
    this.lastSaveFileHandle = handle;
  }

  /**
   * Serializes the current system state to an SVG string.
   * Includes all geometry with cad2d data attributes and a magic state comment.
   */
  save(): SaveResult {
    try {
      const sheet = this.getSheet();
      const viewportControls = this.getViewportControls();
      const selectionManager = this.getSelectionManager();
      const toolManager = this.getToolManager();

      const viewportState = viewportControls?.getState();
      const viewportPosition = viewportState
        ? { x: viewportState.viewport.position.x, y: viewportState.viewport.position.y }
        : { x: 0, y: 0 };
      const viewportScale = viewportState?.viewport.scale ?? 1;

      const selectedIds = selectionManager?.getSelectedIds() ?? [];
      const activeTool = toolManager?.getActiveTool()?.type ?? 'select';

      const svg = serializeToSvg(
        sheet,
        viewportPosition,
        viewportScale,
        selectedIds,
        activeTool
      );

      return { success: true, svg };
    } catch (e) {
      console.error('[cad2d] SerializationManager.save: failed', e);
      return { success: false, svg: null };
    }
  }

  /**
   * Loads state from an SVG string into the system.
   * Parses the SVG, migrates state if necessary, and updates all managers.
   */
  load(svg: string) {
    return this.loadInternal(svg, true);
  }

  /** Takes the given user selection and format the selected elements as a string which can be put
    * into the user's clipboard. */
  loadFragment(svg: string) {
    return this.loadInternal(svg, false);
  }

  private loadInternal(svg: string, eraseExisting: boolean) {
    const result: LoadResult = { success: false, warnings: [] };

    try {
      const parseResult = parseSvg(
        svg,
        this.getHistoryManager().generateStableId.bind(this.getHistoryManager()),
      );
      result.warnings = parseResult.warnings;

      if (!parseResult.isValid) {
        console.error('[cad2d] SerializationManager.load: invalid SVG');
        return result;
      }

      const geometryStore = this.getGeometryStore();
      const historyManager = this.getHistoryManager();
      const selectionManager = this.getSelectionManager();
      const toolManager = this.getToolManager();

      // Clear existing geometry
      if (eraseExisting) {
        geometryStore.polygons = [];
        geometryStore.rectangles = [];
        geometryStore.ellipses = [];
        geometryStore.emit('polygonsChanged', []);
        geometryStore.emit('rectanglesChanged', []);
        geometryStore.emit('ellipsesChanged', []);
      }

      // Add loaded geometry
      for (const polygon of parseResult.polygons) {
        if (eraseExisting) {
          geometryStore.addPolygonDirect(polygon);
        } else {
          geometryStore.addPolygon(polygon);
        }
      }
      for (const rectangle of parseResult.rectangles) {
        if (eraseExisting) {
          geometryStore.addRectangleDirect(rectangle);
        } else {
          geometryStore.addRectangle(rectangle);
        }
      }
      for (const ellipse of parseResult.ellipses) {
        if (eraseExisting) {
          geometryStore.addEllipseDirect(ellipse);
        } else {
          geometryStore.addEllipse(ellipse);
        }
      }

      // Emit change events
      geometryStore.emit('polygonsChanged', geometryStore.polygons);
      geometryStore.emit('rectanglesChanged', geometryStore.rectangles);
      geometryStore.emit('ellipsesChanged', geometryStore.ellipses);

      // Restore history if available
      if (eraseExisting && parseResult.state) {
        const state = parseResult.state;
        historyManager.setUndoStack(state.history.undoStack);
        historyManager.setRedoStack(state.history.redoStack);
        historyManager.setStableIdCounter(state.history.stableIdCounter);
        historyManager.emit('stacksChange');

        // Clear selection
        selectionManager.clearSelection();

        // Restore viewport if available
        const viewportControls = this.getViewportControls();
        if (viewportControls && state.viewport) {
          viewportControls.setViewport(state.viewport.position, state.viewport.scale);
        }

        // Restore active tool
        if (state.activeTool && toolManager) {
          toolManager.setActiveTool(state.activeTool as ToolType);
        }
      }

      result.success = true;
      return result;
    } catch (e) {
      console.error('[cad2d] SerializationManager.load: failed', e);
      return result;
    }
  }

  /** Takes the given user selection and format the selected elements as a string which can be put
    * into the user's clipboard. */
  formatSelectedAsFragment() {
    const geometryStore = this.getGeometryStore();

    const entries: Array<string> = [];
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const [idPrefix] = id.split("_");

      switch (idPrefix as typeof ID_PREFIXES[keyof typeof ID_PREFIXES]) {
        case ID_PREFIXES.polygon:
          const polygon = geometryStore.getPolygonById(id);
          if (polygon) {
            entries.push(serializePolygon(polygon));
          }
          break;
        case ID_PREFIXES.rectangle:
          const rectangle = geometryStore.getRectangleById(id);
          if (rectangle) {
            entries.push(serializeRectangle(rectangle));
          }
          break;
        case ID_PREFIXES.ellipse:
          const ellipse = geometryStore.getEllipseById(id);
          if (ellipse) {
            entries.push(serializeEllipse(ellipse));
          }
          break;
      }
    }

    return entries.length > 0 ? entries.join('\n') : null;
  }

  /**
   * Checks if an SVG string can be loaded.
   * Returns info about whether it's valid, what version it is, and if it's a fallback.
   */
  canLoad(svg: string): CanLoadResult {
    return canLoadSvg(svg);
  }

  private getGeometryStore() {
    return this.actionsManager.getGeometryStore();
  }

  private getHistoryManager() {
    return this.actionsManager.getHistoryManager();
  }

  private getSelectionManager() {
    return this.actionsManager.getSelectionManager();
  }

  private getToolManager() {
    return this.toolManager;
  }

  private getViewportControls() {
    const toolManager = this.getToolManager();
    return toolManager.getViewportControls();
  }
}
