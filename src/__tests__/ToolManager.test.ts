import { Tool, ToolManager } from '../lib/tools/ToolManager';
import { GeometryStore } from '../lib/tools/GeometryStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { ViewportPosition, ScreenPosition, SheetPosition, type ViewportState } from '../lib/viewport/types';
import type { PointSegment, QuadraticBezierSegment, CubicBezierSegment } from '../lib/tools/types';
import { PolygonTool } from '@/lib/tools/PolygonTool';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

function simulateClick(toolManager: ToolManager, x: number, y: number, viewport: ViewportState) {
  toolManager.handleMouseMove(new ScreenPosition(x, y), viewport);
  toolManager.handleMouseDown(new ScreenPosition(x, y), viewport);
}

function simulateAltClick(toolManager: ToolManager, x: number, y: number, viewport: ViewportState) {
  toolManager.handleKeyDown({ key: 'Alt', code: 'Alt' } as unknown as KeyboardEvent);
  toolManager.handleMouseMove(new ScreenPosition(x, y), viewport);
  toolManager.handleMouseDown(new ScreenPosition(x, y), viewport);
  toolManager.handleKeyUp({ key: 'Alt', code: 'Alt' } as unknown as KeyboardEvent);
}

describe('ToolManager', () => {
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;

  let polygonTool: PolygonTool;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);

    polygonTool = toolManager.getTool("polygon");
  });

  describe('initialization', () => {
    it('starts with select tool', () => {
      expect(toolManager.getActiveTool().type).toBe('select');
    });

    it('starts with default cursor', () => {
      expect(toolManager.getCursor()).toBe('default');
    });
  });

  describe('setActiveTool', () => {
    it('switches to move tool', () => {
      toolManager.setActiveTool('move');
      expect(toolManager.getActiveTool().type).toBe('move');
      expect(toolManager.getCursor()).toBe('grab');
    });

    it('switches to polygon tool', () => {
      toolManager.setActiveTool('polygon');
      expect(toolManager.getActiveTool().type).toBe('polygon');
      expect(toolManager.getCursor()).toBe('pointer');
    });

    it('emits toolChange event', () => {
      const spy = jest.fn();
      toolManager.on('toolChange', spy);
      toolManager.setActiveTool('move');
      expect(spy.mock.calls).toHaveLength(1);
      expect(spy.mock.calls[0][0]).toHaveProperty('type', 'move');
    });

    it('clears working polygon when switching away from polygon tool', () => {
      const viewport = createViewportState();
      toolManager.setActiveTool('polygon');
      simulateClick(toolManager, 100, 100, viewport);
      expect(geometryStore.workingPolygon).not.toBeNull();

      toolManager.setActiveTool('select');
      expect(geometryStore.workingPolygon).toBeNull();
    });
  });

  describe('modifier keys', () => {
    it('sets shift modifier on keydown', () => {
      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);
    });

    it('sets super modifier on Meta keydown', () => {
      toolManager.handleKeyDown({ key: 'Meta' } as KeyboardEvent);
      toolManager.handleKeyUp({ key: 'Meta' } as KeyboardEvent);
    });

    it('sets alt modifier on keydown', () => {
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
    });
  });
});
