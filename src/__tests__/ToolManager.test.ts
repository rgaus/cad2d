import { ToolManager } from '../lib/tools/ToolManager';
import { PolygonStore } from '../lib/tools/PolygonStore';
import { ViewportPosition, ScreenPosition, type ViewportState } from '../lib/viewport/types';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('ToolManager', () => {
  let polygonStore: PolygonStore;
  let toolManager: ToolManager;

  beforeEach(() => {
    polygonStore = new PolygonStore();
    toolManager = new ToolManager(polygonStore);
  });

  describe('initialization', () => {
    it('starts with select tool', () => {
      expect(toolManager.getTool()).toBe('select');
    });

    it('starts with default cursor', () => {
      expect(toolManager.getCursor()).toBe('default');
    });
  });

  describe('setTool', () => {
    it('switches to move tool', () => {
      toolManager.setTool('move');
      expect(toolManager.getTool()).toBe('move');
      expect(toolManager.getCursor()).toBe('grab');
    });

    it('switches to polygon tool', () => {
      toolManager.setTool('polygon');
      expect(toolManager.getTool()).toBe('polygon');
      expect(toolManager.getCursor()).toBe('crosshair');
    });

    it('emits toolChange event', () => {
      const spy = jest.fn();
      toolManager.on('toolChange', spy);
      toolManager.setTool('move');
      expect(spy).toHaveBeenCalledWith('move');
    });

    it('clears working polygon when switching away from polygon tool', () => {
      const viewport = createViewportState();
      toolManager.setTool('polygon');
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      expect(polygonStore.workingPolygon).not.toBeNull();

      toolManager.setTool('select');
      expect(polygonStore.workingPolygon).toBeNull();
    });
  });

  describe('polygon drawing', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('starts working polygon on first click', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      expect(polygonStore.workingPolygon).not.toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(1);
      expect(polygonStore.workingPolygon!.previewPoint).toBeNull();
    });

    it('adds points on subsequent clicks', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseMove(new ScreenPosition(200, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 100), viewport);
      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
    });

    it('completes polygon with closed=false on Enter', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseMove(new ScreenPosition(200, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 100), viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(false);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('completes polygon with closed=true when clicking first handle', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseMove(new ScreenPosition(200, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 100), viewport);
      toolManager.completePolygonAtFirstHandle();

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('aborts polygon on Escape', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseMove(new ScreenPosition(200, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(200, 100), viewport);
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(0);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('clears working polygon on Enter with less than 2 points', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(0);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('updates preview point on mouse move', () => {
      toolManager.handleMouseMove(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseDown(new ScreenPosition(100, 100), viewport);
      toolManager.handleMouseMove(new ScreenPosition(150, 150), viewport);

      expect(polygonStore.workingPolygon!.previewPoint).not.toBeNull();
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
  });
});