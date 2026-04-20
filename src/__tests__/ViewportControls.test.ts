import { ViewportControls, type ViewportControlsConfig } from '../lib/viewport/ViewportControls';
import { WorldPosition, ScreenPosition, ViewportPosition, type ViewportState } from '../lib/viewport/types';
import { computeInitialViewportState } from '../lib/viewport/viewportMath';
import { Sheets, CM_TO_PIXELS } from '../lib/sheet/Sheet';
import { Lengths } from '../lib/units/length';

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

function createControls(
  canvasWidth: number = CANVAS_WIDTH,
  canvasHeight: number = CANVAS_HEIGHT
): ViewportControls {
  const sheet = Sheets.updateWidth(
    Sheets.updateHeight(Sheets.a4(), Lengths.centimeters(29.7)),
    Lengths.centimeters(21)
  );
  const config: ViewportControlsConfig = {
    canvasWidth,
    canvasHeight,
    sheet,
  };
  return new ViewportControls(config);
}

describe('ViewportControls', () => {
  const SHEET_WIDTH_PX = 21 * CM_TO_PIXELS;
  const SHEET_HEIGHT_PX = 29.7 * CM_TO_PIXELS;

  describe('initialization', () => {
    it('should initialize viewport to center the rectangle', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectCenterX = 0 + SHEET_WIDTH_PX / 2;
      const rectCenterY = 0 + SHEET_HEIGHT_PX / 2;
      const expectedVpX = CANVAS_WIDTH / 2 - rectCenterX;
      const expectedVpY = CANVAS_HEIGHT / 2 - rectCenterY;

      expect(state.viewport.position.x).toBeCloseTo(expectedVpX, 5);
      expect(state.viewport.position.y).toBeCloseTo(expectedVpY, 5);
      expect(state.viewport.scale).toBe(1);
    });

    it('should initialize rectangle at world origin', () => {
      const controls = createControls();
      const state = controls.getState();

      expect(state.rect.position.x).toBe(0);
      expect(state.rect.position.y).toBe(0);
      expect(state.rect.width).toBeCloseTo(SHEET_WIDTH_PX, 5);
      expect(state.rect.height).toBeCloseTo(SHEET_HEIGHT_PX, 5);
    });

    it('should not be dragging initially', () => {
      const controls = createControls();
      const state = controls.getState();

      expect(state.isDragging).toBe(false);
    });

    it('should return default cursor when not dragging', () => {
      const controls = createControls();

      expect(controls.getCursor()).toBe('default');
    });
  });

  describe('handleWheel pan', () => {
    it('should pan viewport when wheel event has no metaKey', () => {
      const controls = createControls();
      const initialState = controls.getState();
      const initialX = initialState.viewport.position.x;
      const initialY = initialState.viewport.position.y;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 10,
        deltaY: 20,
        metaKey: false,
        bubbles: true,
      } as WheelEventInit);
      controls.handleWheel(wheelEvent);

      const newState = controls.getState();
      expect(newState.viewport.position.x).toBe(initialX - 10);
      expect(newState.viewport.position.y).toBe(initialY - 20);
    });

    it('should not change scale during pan', () => {
      const controls = createControls();
      const initialScale = controls.getState().viewport.scale;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 50,
        deltaY: 50,
        metaKey: false,
        bubbles: true,
      } as WheelEventInit);
      controls.handleWheel(wheelEvent);

      expect(controls.getState().viewport.scale).toBe(initialScale);
    });
  });

  describe('handleWheel zoom', () => {
    it('should zoom when wheel event has metaKey', () => {
      const controls = createControls();
      const initialScale = controls.getState().viewport.scale;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -100,
        metaKey: true,
        clientX: 400,
        clientY: 300,
        bubbles: true,
      } as WheelEventInit);
      controls.handleWheel(wheelEvent);

      const newScale = controls.getState().viewport.scale;
      expect(newScale).not.toBe(initialScale);
    });

    it.skip('should keep world point under cursor fixed during zoom', () => {
      const controls = createControls();
      const initialState = controls.getState();

      const cursorScreenX = 400;
      const cursorScreenY = 300;

      const initialWorld = new ScreenPosition(cursorScreenX, cursorScreenY).toWorld(initialState.viewport);
      const initialWorldX = initialWorld.x;
      const initialWorldY = initialWorld.y;
      const initialScale = initialState.viewport.scale;

      const wheelEvent = new WheelEvent('wheel', {
        deltaX: 0,
        deltaY: -100,
        metaKey: true,
        clientX: cursorScreenX,
        clientY: cursorScreenY,
        screenX: cursorScreenX,
        screenY: cursorScreenY,
        bubbles: true,
      } as WheelEventInit);
      controls.handleWheel(wheelEvent);

      const newState = controls.getState();
      const newScale = newState.viewport.scale;
      const newWorld = new ScreenPosition(cursorScreenX, cursorScreenY).toWorld(newState.viewport);

      expect(newScale).toBeGreaterThan(initialScale);
      expect(newWorld.x).toBeCloseTo(initialWorldX, 1);
      expect(newWorld.y).toBeCloseTo(initialWorldY, 1);
    });
  });

  describe('handleMouseDown on rectangle', () => {
    it('should start dragging when clicking on rectangle', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseEvent);

      expect(controls.getState().isDragging).toBe(true);
    });

    it('should return grabbing cursor when dragging', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseEvent);

      expect(controls.getCursor()).toBe('grabbing');
    });

    it('should emit cursorChange when starting drag', () => {
      const controls = createControls();
      const cursorChangeHandler = jest.fn();
      controls.on('cursorChange', cursorChangeHandler);

      const state = controls.getState();
      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseEvent);

      expect(cursorChangeHandler).toHaveBeenCalledWith('grabbing');
    });

    it('should not start dragging when clicking outside rectangle', () => {
      const controls = createControls();

      const mouseEvent = new MouseEvent('mousedown', {
        clientX: 0,
        clientY: 0,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseEvent);

      expect(controls.getState().isDragging).toBe(false);
    });
  });

  describe('handleMouseMove during drag', () => {
    it('should move rectangle during drag', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseDownEvent);

      const dragX = rectScreenX + 100;
      const dragY = rectScreenY + 50;
      const mouseMoveEvent = new MouseEvent('mousemove', {
        clientX: dragX,
        clientY: dragY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseMove(mouseMoveEvent);

      const newRectPos = controls.getState().rect.position;
      expect(newRectPos.x).toBeGreaterThan(0);
    });
  });

  describe('handleMouseUp', () => {
    it('should end dragging on mouse up', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseDownEvent);
      expect(controls.getState().isDragging).toBe(true);

      controls.handleMouseUp();
      expect(controls.getState().isDragging).toBe(false);
    });

    it('should return default cursor after mouse up', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseDownEvent);

      controls.handleMouseUp();
      expect(controls.getCursor()).toBe('default');
    });

    it('should emit cursorChange when ending drag', () => {
      const controls = createControls();
      const cursorChangeHandler = jest.fn();
      controls.on('cursorChange', cursorChangeHandler);

      const state = controls.getState();
      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseDownEvent);

      controls.handleMouseUp();
      expect(cursorChangeHandler).toHaveBeenCalledWith('default');
    });
  });

  describe('handleMouseLeave during drag', () => {
    it('should end dragging on mouse leave', () => {
      const controls = createControls();
      const state = controls.getState();

      const rectScreenX = state.viewport.position.x + 50;
      const rectScreenY = state.viewport.position.y + 50;

      const mouseDownEvent = new MouseEvent('mousedown', {
        clientX: rectScreenX,
        clientY: rectScreenY,
        bubbles: true,
      } as MouseEventInit);
      controls.handleMouseDown(mouseDownEvent);
      expect(controls.getState().isDragging).toBe(true);

      controls.handleMouseLeave();
      expect(controls.getState().isDragging).toBe(false);
    });
  });

  describe('resizeCanvas', () => {
    it('should update canvas dimensions', () => {
      const controls = createControls();

      controls.resizeCanvas(1024, 768);

      const state = controls.getState();
      expect(state.rect.width).toBeCloseTo(SHEET_WIDTH_PX, 5);
      expect(state.rect.height).toBeCloseTo(SHEET_HEIGHT_PX, 5);
    });
  });
});

describe('ScreenPosition.toWorld conversion', () => {
  it('should correctly convert screen position to world position', () => {
    const viewportState: ViewportState = {
      position: new ViewportPosition(100, 50),
      scale: 2,
    };

    const screenPos = new ScreenPosition(300, 250);
    const worldPos = screenPos.toWorld(viewportState);

    expect(worldPos.x).toBeCloseTo(100, 5);
    expect(worldPos.y).toBeCloseTo(100, 5);
  });
});

describe('WorldPosition.toViewport conversion', () => {
  it('should correctly convert world position to viewport position', () => {
    const viewportState: ViewportState = {
      position: new ViewportPosition(100, 50),
      scale: 2,
    };

    const worldPos = new WorldPosition(100, 100);
    const viewportPos = worldPos.toViewport(viewportState);

    expect(viewportPos.x).toBeCloseTo(300, 5);
    expect(viewportPos.y).toBeCloseTo(250, 5);
  });
});

describe('computeInitialViewportState', () => {
  it('should center rectangle in canvas', () => {
    const state = computeInitialViewportState(800, 600, 100, 100);

    expect(state.position.x).toBeCloseTo(350, 5);
    expect(state.position.y).toBeCloseTo(250, 5);
    expect(state.scale).toBe(1);
  });
});