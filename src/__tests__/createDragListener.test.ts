import { createDragListener } from '../lib/drag/createDragListener';
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
