import { ScreenPosition } from '../viewport/types';

/** Configuration for a drag listener. */
export type DragListenerConfig = {
  /** Called on each mousemove during the drag. Receives the current screen position. */
  onMove: (screenPos: ScreenPosition) => void;
  /** Called on mouseup when the drag is committed. Receives the final screen position. */
  onCommit: (finalScreenPos: ScreenPosition) => void;
  /** Called when the drag is cancelled (e.g., via Escape or component unmount). */
  onCancel: () => void;
};

/** Result of createDragListener. */
export type DragListener = {
  /** Detaches all window listeners. Call when the drag ends or the component unmounts. */
  destroy: () => void;
};

/**
 * Attaches window-level mousemove and mouseup listeners to implement drag tracking.
 * Returns a destroy() function to detach the listeners early.
 *
 * @param config - callbacks for move, commit, and cancel events
 * @returns a DragListener with a destroy method
 */
export function createDragListener(config: DragListenerConfig): DragListener {
  const { onMove, onCommit, onCancel } = config;

  let cancelled = false;

  function onWindowMouseMove(e: MouseEvent) {
    if (cancelled) {
      return;
    }
    // Use client coordinates from the mouse event (consistent with PixiJS FederatedPointerEvent).
    onMove(new ScreenPosition(e.clientX, e.clientY));
  }

  function onWindowMouseUp(e: MouseEvent) {
    if (cancelled) {
      return;
    }
    cancelled = true;

    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
    onCommit(new ScreenPosition(e.clientX, e.clientY));
  }

  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);

  return {
    destroy() {
      cancelled = true;
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      onCancel();
    },
  };
}
