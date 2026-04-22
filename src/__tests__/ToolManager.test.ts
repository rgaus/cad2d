import { ToolManager } from '../lib/tools/ToolManager';
import { PolygonStore } from '../lib/tools/PolygonStore';
import { SelectionManager } from '../lib/tools/SelectionManager';
import { HistoryManager } from '../lib/history/HistoryManager';
import { ViewportPosition, ScreenPosition, SheetPosition, type ViewportState } from '../lib/viewport/types';
import type { PointSegment, QuadraticBezierSegment, CubicBezierSegment } from '../lib/tools/types';

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
  let polygonStore: PolygonStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    polygonStore = new PolygonStore(historyManager);
    historyManager.setPolygonStore(polygonStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(polygonStore, selectionManager, historyManager);
  });

  describe('initialization', () => {
    it('starts with select tool', () => {
      expect(toolManager.getTool()).toBe('select');
    });

    it('starts with default cursor', () => {
      expect(toolManager.getCursor()).toBe('default');
    });

    it('starts with arcDrawMode = quadratic', () => {
      expect(toolManager.arcDrawMode).toBe('quadratic');
    });

    it('starts not hovering first handle', () => {
      expect(toolManager.isHoveringFirstHandle).toBe(false);
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
      expect(toolManager.getCursor()).toBe('pointer');
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
      simulateClick(toolManager, 100, 100, viewport);
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
      simulateClick(toolManager, 100, 100, viewport);
      expect(polygonStore.workingPolygon).not.toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(1);
      expect(polygonStore.workingPolygon!.previewPoint).toBeNull();
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
    });

    it('first point is a point segment', () => {
      simulateClick(toolManager, 100, 100, viewport);
      const seg = polygonStore.workingPolygon!.points[0];
      expect(seg.type).toBe('point');
      const pointSeg = seg as PointSegment;
      expect(pointSeg.point).toBeInstanceOf(SheetPosition);
    });

    it('adds point segments on subsequent clicks', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateClick(toolManager, 200, 100, viewport);
      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
      expect(polygonStore.workingPolygon!.points[0].type).toBe('point');
      expect(polygonStore.workingPolygon!.points[1].type).toBe('point');
    });

    it('updates preview point on mouse move', () => {
      simulateClick(toolManager, 100, 100, viewport);
      toolManager.handleMouseMove(new ScreenPosition(150, 150), viewport);
      expect(polygonStore.workingPolygon!.previewPoint).not.toBeNull();
    });

    it('completes polygon with closed=false on Enter', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(false);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('completes polygon with closed=true when clicking first handle', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateClick(toolManager, 200, 100, viewport);
      toolManager.completePolygonAtFirstHandle();

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('aborts polygon on Escape', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(0);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('clears working polygon on Enter with less than 2 segments', () => {
      simulateClick(toolManager, 100, 100, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(0);
      expect(polygonStore.workingPolygon).toBeNull();
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

  describe('setHoveringFirstHandle', () => {
    it('emits hoveringFirstHandleChange when value changes', () => {
      const spy = jest.fn();
      toolManager.on('hoveringFirstHandleChange', spy);
      toolManager.setHoveringFirstHandle(true);
      expect(spy).toHaveBeenCalledWith(true);
      spy.mockClear();
      toolManager.setHoveringFirstHandle(false);
      expect(spy).toHaveBeenCalledWith(false);
    });

    it('does not emit when value is unchanged', () => {
      const spy = jest.fn();
      toolManager.on('hoveringFirstHandleChange', spy);
      toolManager.setHoveringFirstHandle(true);
      toolManager.setHoveringFirstHandle(true);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('arc drawing — alt+click sets pending state', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('alt+click sets pendingArcEndPoint without adding to points', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);

      expect(polygonStore.workingPolygon!.pendingArcEndPoint).not.toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(1);
    });

    it('second click after alt+click creates arc-quadratic segment in quadratic mode', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
      expect(polygonStore.workingPolygon!.points[1].type).toBe('arc-quadratic');
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
    });

    it('arc-quadratic controlPoint is the user-clicked position (direct control point)', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as QuadraticBezierSegment;
      expect(arc.controlPoint).toBeInstanceOf(SheetPosition);
    });

    it('arc-quadratic point is the alt+clicked position', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as QuadraticBezierSegment;
      expect(arc.point).toBeInstanceOf(SheetPosition);
    });

    it('can mix point segments and arc-quadratic segments', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateClick(toolManager, 200, 100, viewport);
      simulateAltClick(toolManager, 300, 100, viewport);
      simulateClick(toolManager, 250, 50, viewport);
      simulateClick(toolManager, 400, 100, viewport);

      const points = polygonStore.workingPolygon!.points;
      expect(points).toHaveLength(4);
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('point');
      expect(points[2].type).toBe('arc-quadratic');
      expect(points[3].type).toBe('point');
    });
  });

  describe('arc drawing — cubic mode', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
      toolManager.arcDrawMode = 'cubic';
    });

    it('second click after alt+click creates arc-cubic segment', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
      expect(polygonStore.workingPolygon!.points[1].type).toBe('arc-cubic');
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
    });

    it('arc-cubic controlPointA is the user-clicked position', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as CubicBezierSegment;
      expect(arc.controlPointA).toBeInstanceOf(SheetPosition);
    });

    it('arc-cubic controlPointB is computed', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as CubicBezierSegment;
      expect(arc.controlPointB).toBeInstanceOf(SheetPosition);
    });

    it('arc-cubic point is the alt+clicked position', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as CubicBezierSegment;
      expect(arc.point).toBeInstanceOf(SheetPosition);
    });
  });

  describe('arcDrawMode switching', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('b key switches to cubic mode when pendingArcEndPoint is set', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);

      const spy = jest.fn();
      toolManager.on('arcDrawModeChange', spy);
      toolManager.handleKeyDown({ key: 'b' } as KeyboardEvent);

      expect(toolManager.arcDrawMode).toBe('cubic');
      expect(spy).toHaveBeenCalledWith('cubic');
    });

    it('m key switches to quadratic mode when pendingArcEndPoint is set', () => {
      toolManager.arcDrawMode = 'cubic';
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);

      const spy = jest.fn();
      toolManager.on('arcDrawModeChange', spy);
      toolManager.handleKeyDown({ key: 'm' } as KeyboardEvent);

      expect(toolManager.arcDrawMode).toBe('quadratic');
      expect(spy).toHaveBeenCalledWith('quadratic');
    });

    it('b key is no-op when pendingArcEndPoint is not set', () => {
      toolManager.handleKeyDown({ key: 'b' } as KeyboardEvent);
      expect(toolManager.arcDrawMode).toBe('quadratic');
    });

    it('m key is no-op when pendingArcEndPoint is not set', () => {
      toolManager.handleKeyDown({ key: 'm' } as KeyboardEvent);
      expect(toolManager.arcDrawMode).toBe('quadratic');
    });

    it('uppercase B switches to cubic mode', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'B' } as KeyboardEvent);
      expect(toolManager.arcDrawMode).toBe('cubic');
    });

    it('uppercase M switches to quadratic mode', () => {
      toolManager.arcDrawMode = 'cubic';
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'M' } as KeyboardEvent);
      expect(toolManager.arcDrawMode).toBe('quadratic');
    });
  });

  describe('arc pending state clearing', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('Escape clears pendingArcEndPoint without clearing working polygon', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);

      expect(polygonStore.workingPolygon!.pendingArcEndPoint).not.toBeNull();
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
      expect(polygonStore.workingPolygon).not.toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(1);
    });

    it('Escape clears pendingArcEndPoint, then second Escape aborts polygon', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('Enter does not complete polygon with only 1 segment even with pendingArcEndPoint', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(0);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('Enter completes polygon when arc is fully placed (2+ segments)', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.workingPolygon).toBeNull();
    });

    it('completing polygon via first handle clears pendingArcEndPoint', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      toolManager.completePolygonAtFirstHandle();

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.workingPolygon).toBeNull();
    });
  });

  describe('arc drawing sequence', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('click, alt+click, click creates arc, then click adds point', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      simulateClick(toolManager, 300, 100, viewport);

      const points = polygonStore.workingPolygon!.points;
      expect(points).toHaveLength(3);
      expect(points[0].type).toBe('point');
      expect(points[1].type).toBe('arc-quadratic');
      expect(points[2].type).toBe('point');
    });

    it('can place multiple arcs in sequence', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      simulateAltClick(toolManager, 300, 100, viewport);
      simulateClick(toolManager, 250, 50, viewport);

      const points = polygonStore.workingPolygon!.points;
      expect(points).toHaveLength(3);
      expect(points[1].type).toBe('arc-quadratic');
      expect(points[2].type).toBe('arc-quadratic');
    });

    it('switching to cubic mid-arc works', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      toolManager.handleKeyDown({ key: 'b' } as KeyboardEvent);
      simulateClick(toolManager, 150, 50, viewport);

      const arc = polygonStore.workingPolygon!.points[1] as CubicBezierSegment;
      expect(arc.type).toBe('arc-cubic');
      expect(arc.controlPointA).toBeInstanceOf(SheetPosition);
    });
  });

  describe('completed polygon with arcs', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('completes polygon with arc segments', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      simulateClick(toolManager, 300, 100, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(1);
      const poly = polygonStore.polygons[0];
      expect(poly.points).toHaveLength(3);
      expect(poly.points[1].type).toBe('arc-quadratic');
      expect(poly.closed).toBe(false);
    });

    it('completes polygon with arc segments and closed=true', () => {
      simulateClick(toolManager, 100, 100, viewport);
      simulateAltClick(toolManager, 200, 100, viewport);
      simulateClick(toolManager, 150, 50, viewport);
      toolManager.completePolygonAtFirstHandle();

      const poly = polygonStore.polygons[0];
      expect(poly.closed).toBe(true);
    });
  });

  describe('arc closing — alt + first handle hover', () => {
    let viewport: ViewportState;
    let prevIsHoveringFirstHandle: boolean;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
      prevIsHoveringFirstHandle = toolManager.isHoveringFirstHandle;
      toolManager.resetForTesting();
    });

    afterEach(() => {
      toolManager.setHoveringFirstHandle(prevIsHoveringFirstHandle);
    });

    it('clicking first handle with alt held on hover sets pendingArcEndPoint to first point', () => {
      // Use screen coords that map cleanly to sheet coords (x62.5: 125->2, 250->4, etc.)
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      // Start not hovering (setHoveringFirstHandle(false)), then start hovering (true)
      // so setHoveringFirstHandle captures altHeldOnFirstHandleHover on the transition
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      // handleMouseMove updates preview state after the hover transition
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      // Clicking the first handle while hovering should start arc-close flow
      toolManager.handleMouseDown(new ScreenPosition(125, 125), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // pendingArcEndPoint stores sheet coordinates (screen 125 / CM_TO_PIXELS = 2)
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).not.toBeNull();
      expect(polygonStore.workingPolygon!.pendingArcEndPoint!.x).toBe(2);
      expect(polygonStore.workingPolygon!.pendingArcEndPoint!.y).toBe(2);
      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
    });

    it('placing control point after arc-close creates arc and polygon closed=true', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      toolManager.handleMouseDown(new ScreenPosition(125, 125), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);

      // Place control point (screen 187/CM_TO_PIXELS=3 → sheet ~3)
      simulateClick(toolManager, 187, 187, viewport);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
      expect(polygonStore.polygons[0].points).toHaveLength(3);
      expect(polygonStore.polygons[0].points[2].type).toBe('arc-quadratic');
    });

    it('Enter after placing control point completes polygon closed=true', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      toolManager.handleMouseDown(new ScreenPosition(125, 125), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
      simulateClick(toolManager, 187, 187, viewport);
      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
    });

    it('Escape after arc-close flow clears pending only, not polygon', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      toolManager.handleMouseDown(new ScreenPosition(125, 125), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(polygonStore.workingPolygon).not.toBeNull();
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
    });

    it('cubic mode respected when closing arc', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      toolManager.handleKeyDown({ key: 'Alt' } as KeyboardEvent);
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      toolManager.handleMouseDown(new ScreenPosition(125, 125), viewport);
      toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
      toolManager.handleKeyDown({ key: 'b' } as KeyboardEvent);
      simulateClick(toolManager, 187, 187, viewport);

      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
      expect(polygonStore.polygons[0].points[2].type).toBe('arc-cubic');
    });

    it('alt was NOT held on hover — clicking first handle closes normally (no arc-close)', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      // Hover first handle WITHOUT alt — setHoveringFirstHandle(false) then (true)
      // so setHoveringFirstHandle sees the transition, but alt is NOT held
      toolManager.setHoveringFirstHandle(false);
      toolManager.setHoveringFirstHandle(true);
      toolManager.handleMouseMove(new ScreenPosition(125, 125), viewport);
      // Clicking the first handle while hovering triggers completePolygonAtFirstHandle
      toolManager.completePolygonAtFirstHandle();

      // Should have completed the polygon normally (closed=true), not started arc-close
      expect(polygonStore.polygons).toHaveLength(1);
      expect(polygonStore.polygons[0].closed).toBe(true);
      expect(polygonStore.workingPolygon).toBeNull();
    });
  });

  describe('backspace deletes last segment', () => {
    let viewport: ViewportState;

    beforeEach(() => {
      viewport = createViewportState(1);
      toolManager.setTool('polygon');
    });

    it('backspace deletes the last point from a polygon', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      simulateClick(toolManager, 250, 250, viewport);

      expect(polygonStore.workingPolygon!.points).toHaveLength(3);

      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
      expect(polygonStore.workingPolygon!.points[0].point.x).toBe(2);
      expect(polygonStore.workingPolygon!.points[0].point.y).toBe(2);
      expect(polygonStore.workingPolygon!.points[1].point.x).toBe(4);
      expect(polygonStore.workingPolygon!.points[1].point.y).toBe(2);
      expect(polygonStore.polygons).toHaveLength(0);
    });

    it('backspace during pending arc cancels the pending arc', () => {
      simulateClick(toolManager, 125, 125, viewport);
      simulateClick(toolManager, 250, 125, viewport);
      // Start an arc with alt
      simulateAltClick(toolManager, 250, 250, viewport);

      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // abortPolygon clears pendingArcEndPoint and keeps the polygon
      expect(polygonStore.workingPolygon!.pendingArcEndPoint).toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(2);
    });

    it('backspace with only 1 point calls abortPolygon', () => {
      simulateClick(toolManager, 125, 125, viewport);

      expect(polygonStore.workingPolygon).not.toBeNull();
      expect(polygonStore.workingPolygon!.points).toHaveLength(1);

      toolManager.handleKeyDown({ key: 'Backspace' } as KeyboardEvent);

      // Working polygon no longer exists
      expect(polygonStore.workingPolygon).toBeNull();
    });
  });
});
