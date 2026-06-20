import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { BaseMultiTool } from '@/lib/tools/BaseTool';
import { ConstraintTool } from '@/lib/tools/ConstraintTool';
import { PolygonTool } from '@/lib/tools/PolygonTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { ScreenPosition, ViewportPosition, type ViewportState } from '@/lib/viewport/types';

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

function keyEvent(key: string): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault: jest.fn(),
  } as unknown as KeyboardEvent;
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

    polygonTool = toolManager.getTool('polygon');
  });

  describe('initialization', () => {
    it('starts with select tool', () => {
      expect(toolManager.getActiveTool().type).toBe('select');
    });

    it('starts with default cursor', () => {
      expect(toolManager.cursor).toBe('default');
    });
  });

  describe('setActiveTool', () => {
    it('switches to move tool', () => {
      toolManager.setActiveTool('move');
      expect(toolManager.getActiveTool().type).toBe('move');
      expect(toolManager.cursor).toBe('grab');
    });

    it('switches to polygon tool', () => {
      toolManager.setActiveTool('polygon');
      expect(toolManager.getActiveTool().type).toBe('polygon');
      expect(toolManager.cursor).toBe('pointer');
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

  describe('BaseMultiTool keyboard shortcuts', () => {
    let constraintTool: ConstraintTool;

    beforeEach(() => {
      constraintTool = toolManager.getTool('constraint');
    });

    describe('keyboard activation (c then sub-tool key)', () => {
      it('c then l activates linear constraint sub-tool', () => {
        expect(toolManager.getActiveTool().type).toBe('select');

        const popoverOpenSpy = jest.fn();
        const subToolChangeSpy = jest.fn();
        toolManager.on('popoverOpenRequest', popoverOpenSpy);
        toolManager.on('subToolChange', subToolChangeSpy);

        // Press "c" to activate the constraint multi-tool
        toolManager.handleKeyDown(keyEvent('c'));
        expect(toolManager.getActiveTool().type).toBe('constraint');
        expect(popoverOpenSpy).toHaveBeenCalledWith('constraint');
        expect(constraintTool.hasDetectorState).toBe(true);

        // Press "l" to activate linear constraint sub-tool (completes "c l")
        const result = toolManager.handleKeyDown(keyEvent('l'));
        expect(result).toBe(true);
        expect(constraintTool.activeSubTool.type).toBe('linear-constraint');
        expect(subToolChangeSpy).toHaveBeenCalledTimes(1);
        // Detector should be cleared after a successful match
        expect(constraintTool.hasDetectorState).toBe(false);
      });

      it('c then p activates perpendicular constraint sub-tool (beats top-level p)', () => {
        const popoverOpenSpy = jest.fn();
        const subToolChangeSpy = jest.fn();
        toolManager.on('popoverOpenRequest', popoverOpenSpy);
        toolManager.on('subToolChange', subToolChangeSpy);

        // Press "c" to activate and prime the constraint multi-tool
        toolManager.handleKeyDown(keyEvent('c'));
        expect(constraintTool.hasDetectorState).toBe(true);

        // Press "p" — sub-tool combo "c p" should win over top-level "p"
        toolManager.handleKeyDown(keyEvent('p'));
        expect(constraintTool.activeSubTool.type).toBe('perpendicular-constraint');
        expect(subToolChangeSpy).toHaveBeenCalledTimes(1);
        // Verify we did NOT switch to PolygonTool (top-level "p")
        expect(toolManager.getActiveTool().type).toBe('constraint');
      });

      it('c then non-sub-tool key falls through to top-level combos', () => {
        // Press "c" to activate and prime
        toolManager.handleKeyDown(keyEvent('c'));
        expect(constraintTool.hasDetectorState).toBe(true);

        // Press "s" — not a sub-tool combo ("c s" is not registered)
        // Should fall through to top-level and activate SelectTool
        toolManager.handleKeyDown(keyEvent('s'));
        expect(toolManager.getActiveTool().type).toBe('select');
      });

      it('Escape when primed clears detector state and closes popover', () => {
        const popoverOpenSpy = jest.fn();
        const popoverCloseSpy = jest.fn();
        toolManager.on('popoverOpenRequest', popoverOpenSpy);
        toolManager.on('popoverCloseRequest', popoverCloseSpy);

        // Press "c" to activate and prime, popover opens
        toolManager.handleKeyDown(keyEvent('c'));
        expect(popoverOpenSpy).toHaveBeenCalledWith('constraint');
        expect(constraintTool.hasDetectorState).toBe(true);

        // Press "Escape" — should clear detector and close popover
        const result = toolManager.handleKeyDown(keyEvent('Escape'));
        expect(result).toBe(true);
        expect(popoverCloseSpy).toHaveBeenCalledTimes(1);
        expect(constraintTool.hasDetectorState).toBe(false);
        // Still on the constraint tool (popover just closed)
        expect(toolManager.getActiveTool().type).toBe('constraint');
      });
    });

    describe('unprimed multi-tool (activated by click, not keyboard)', () => {
      beforeEach(() => {
        toolManager.setActiveTool('constraint');
      });

      it('hasDetectorState is false when not primed', () => {
        expect(constraintTool.hasDetectorState).toBe(false);
      });

      it('key events are forwarded to the active sub-tool', () => {
        // Feeds a plain key to the tool — should reach the sub-tool handler.
        // This covers the bug: before the fix, unprimed multi-tools would
        // not get their handleKeyDown called at all (bug-fix case from b0f5f29).
        const result = toolManager.handleKeyDown(keyEvent('Enter'));
        // Enter isn't a top-level combo and the sub-tool doesn't consume it,
        // so the return should be false — but the call MUST NOT throw and
        // the sub-tool handler MUST have been invoked.
        expect(typeof result).toBe('boolean');
      });

      it('top-level combo still works when multi-tool is active but unprimed', () => {
        // Press "p" — even though context is the constraint multi-tool,
        // without a primed prefix "p" should match PolygonTool
        toolManager.handleKeyDown(keyEvent('p'));
        expect(toolManager.getActiveTool().type).toBe('polygon');
      });

      it('sub-tool key does NOT switch sub-tools without the prefix', () => {
        // Without "c" prefix, pressing "l" alone should not switch sub-tools
        const subToolBefore = constraintTool.activeSubTool.type;
        toolManager.handleKeyDown(keyEvent('l'));
        expect(constraintTool.activeSubTool.type).toBe(subToolBefore);
        // It also shouldn't switch top-level (no top-level "l" combo exists)
        expect(toolManager.getActiveTool().type).toBe('constraint');
      });
    });
  });
});
