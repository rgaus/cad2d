import { createDragListener } from '@/lib/drag/create-drag-listener';
import { Sheet } from '../lib/sheet/Sheet';
import { ViewportControls } from '../lib/viewport/ViewportControls';
import { ScreenPosition } from '../lib/viewport/types';

describe('createDragListener', () => {
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;
  let moveHandler: any;
  let upHandler: any;

  beforeEach(() => {
    moveHandler = undefined;
    upHandler = undefined;
    addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
    addEventListenerSpy.mockImplementation((event: string, handler: any) => {
      if (event === 'mousemove') moveHandler = handler;
      if (event === 'mouseup') upHandler = handler;
    });
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('attaches mousemove and mouseup listeners to window', () => {
    createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
    });

    expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('calls onMove with the correct screen position on mousemove', () => {
    const onMove = jest.fn();
    createDragListener({
      onMove,
      onCommit: () => {},
      onCancel: () => {},
    });

    moveHandler({ clientX: 100, clientY: 200 });

    expect(onMove).toHaveBeenCalledTimes(1);
    const pos = onMove.mock.calls[0][0] as ScreenPosition;
    expect(pos.x).toBe(100);
    expect(pos.y).toBe(200);
  });

  it('calls onCommit with the correct screen position on mouseup', () => {
    const onCommit = jest.fn();
    createDragListener({
      onMove: () => {},
      onCommit,
      onCancel: () => {},
    });

    upHandler({ clientX: 300, clientY: 400 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const pos = onCommit.mock.calls[0][0] as ScreenPosition;
    expect(pos.x).toBe(300);
    expect(pos.y).toBe(400);
  });

  it('removes listeners from window on mouseup', () => {
    createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
    });

    upHandler({ clientX: 0, clientY: 0 });

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });

  it('destroy removes listeners and calls onCancel', () => {
    const onCancel = jest.fn();
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel,
    });

    listener.destroy();

    expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not call onCommit after destroy', () => {
    const onCommit = jest.fn();
    const listener = createDragListener({
      onMove: () => {},
      onCommit,
      onCancel: () => {},
    });

    listener.destroy();
    upHandler({ clientX: 0, clientY: 0 });

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('createDragListener viewport nudge', () => {
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;
  let moveHandler: any;
  let upHandler: any;
  let viewportControls: ViewportControls;
  let nudgeHandler: jest.Mock;

  beforeEach(() => {
    moveHandler = undefined;
    upHandler = undefined;
    addEventListenerSpy = jest.spyOn(window, 'addEventListener');
    removeEventListenerSpy = jest.spyOn(window, 'removeEventListener').mockImplementation(() => {});
    addEventListenerSpy.mockImplementation((event: string, handler: any) => {
      if (event === 'mousemove') moveHandler = handler;
      if (event === 'mouseup') upHandler = handler;
    });

    const sheet = Sheet.a4();
    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
    nudgeHandler = jest.fn();
    jest.spyOn(viewportControls, 'nudge').mockImplementation(nudgeHandler);
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    jest.restoreAllMocks();
  });

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('nudges up when cursor near top edge', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 400, clientY: 10 });
    jest.advanceTimersByTime(100);

    expect(nudgeHandler).toHaveBeenCalledWith('y', 16);
    listener.destroy();
  });

  it('nudges down when cursor near bottom edge', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 400, clientY: 590 });
    jest.advanceTimersByTime(100);

    expect(nudgeHandler).toHaveBeenCalledWith('y', -16);
    listener.destroy();
  });

  it('nudges left when cursor near left edge', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 10, clientY: 300 });
    jest.advanceTimersByTime(100);

    expect(nudgeHandler).toHaveBeenCalledWith('x', 16);
    listener.destroy();
  });

  it('nudges right when cursor near right edge', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 790, clientY: 300 });
    jest.advanceTimersByTime(100);

    expect(nudgeHandler).toHaveBeenCalledWith('x', -16);
    listener.destroy();
  });

  it('nudges in both directions at top-left corner', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 10, clientY: 10 });
    jest.advanceTimersByTime(100);

    expect(nudgeHandler).toHaveBeenCalledTimes(2);
    expect(nudgeHandler).toHaveBeenCalledWith('x', 16);
    expect(nudgeHandler).toHaveBeenCalledWith('y', 16);
    listener.destroy();
  });

  it('does not nudge when pushViewportOnEdges is false', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      pushViewportOnEdges: false,
      viewportControls,
    });

    moveHandler({ clientX: 10, clientY: 10 });
    jest.advanceTimersByTime(200);

    expect(nudgeHandler).not.toHaveBeenCalled();
    listener.destroy();
  });

  it('does not nudge when cursor is in the middle of the viewport', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 400, clientY: 300 });
    jest.advanceTimersByTime(200);

    expect(nudgeHandler).not.toHaveBeenCalled();
    listener.destroy();
  });

  it('clears nudge interval on destroy', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 10, clientY: 10 });
    jest.advanceTimersByTime(50);
    listener.destroy();

    jest.advanceTimersByTime(200);

    expect(nudgeHandler).not.toHaveBeenCalled();
  });

  it('clears nudge interval on mouseup', () => {
    const listener = createDragListener({
      onMove: () => {},
      onCommit: () => {},
      onCancel: () => {},
      viewportControls,
    });

    moveHandler({ clientX: 10, clientY: 10 });
    jest.advanceTimersByTime(50);
    upHandler({ clientX: 10, clientY: 10 });

    jest.advanceTimersByTime(200);

    expect(nudgeHandler).not.toHaveBeenCalled();
  });
});
