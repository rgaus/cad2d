import { ScreenPosition } from '../viewport/types';
import { ViewportControls } from '../viewport/ViewportControls';

const VIEWPORT_NUDGE_INSET_PX = 32;
const VIEWPORT_NUDGE_INTERVAL_MS = 100;
const VIEWPORT_NUDGE_AMOUNT_PX = 16;

type NudgeDirection = 'up' | 'down' | 'left' | 'right';

/** Configuration for a drag listener. */
export type DragListenerConfig = {
  /** Called on each mousemove during the drag. Receives the current screen position. */
  onMove: (screenPos: ScreenPosition) => void;
  /** Called on mouseup when the drag is committed. Receives the final screen position. */
  onCommit: (finalScreenPos: ScreenPosition) => void;
  /** Called when the drag is cancelled (e.g., via Escape or component unmount). */
  onCancel: () => void;
  /** When the cursor gets close to the edge of the viewport, nudges the viewport in the proper
    * direction. Defaults to true. */
  pushViewportOnEdges?: boolean;
  viewportControls?: ViewportControls;
  /** Offset all mouse events by a static amount in the X direction. Used so that a user can click
    * and drag a handle in one location (ie, an offset selection bounding box) yet act as if mouse
    * events are coming from a more convenient location for math (ie, right on the bounding box
    * border instead of the offset bounding box) */
  initialPointerDownOffsetXPx?: number;
  /** Offset all mouse events by a static amount in the Y direction. Used so that a user can click
    * and drag a handle in one location (ie, an offset selection bounding box) yet act as if mouse
    * events are coming from a more convenient location for math (ie, right on the bounding box
    * border instead of the offset bounding box) */
  initialPointerDownOffsetYPx?: number;
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
  const {
    onMove,
    onCommit,
    onCancel,
    pushViewportOnEdges = true,
    viewportControls,
    initialPointerDownOffsetXPx = 0,
    initialPointerDownOffsetYPx = 0,
  } = config;

  let cancelled = false;

  let lastScreenPosition: ScreenPosition | null = null;

  let nudgeInterval: { id: ReturnType<typeof setInterval>, directions: Array<NudgeDirection> } | null = null;

  function onWindowMouseMove(e: MouseEvent) {
    if (cancelled) {
      return;
    }

    const screenPosition = new ScreenPosition(
      e.clientX + initialPointerDownOffsetXPx,
      e.clientY + initialPointerDownOffsetYPx,
    );
    lastScreenPosition = screenPosition;

    // If the user's cursor is near the edge of the screen, nudge it in the given direction.
    if (pushViewportOnEdges) {
      const viewportState = viewportControls?.getState();
      const viewportWidthPx = viewportControls?.getCanvasWidth();
      const viewportHeightPx = viewportControls?.getCanvasHeight();
      const nudgeDirections: Array<NudgeDirection> = [];
      if (viewportState && typeof viewportWidthPx === 'number' && typeof viewportHeightPx === 'number') {
        if (screenPosition.y < VIEWPORT_NUDGE_INSET_PX) {
          nudgeDirections.push('up');
        } else if (screenPosition.y > viewportHeightPx - VIEWPORT_NUDGE_INSET_PX) {
          nudgeDirections.push('down');
        }
        if (screenPosition.x < VIEWPORT_NUDGE_INSET_PX) {
          nudgeDirections.push('left');
        } else if (screenPosition.x > viewportWidthPx - VIEWPORT_NUDGE_INSET_PX) {
          nudgeDirections.push('right');
        }
      }

      if (!nudgeInterval || JSON.stringify(nudgeInterval?.directions) !== JSON.stringify(nudgeDirections)) {
        if (nudgeInterval) {
          clearInterval(nudgeInterval.id);
          nudgeInterval = null;
        }

        if (nudgeDirections.length > 0) {
          nudgeInterval = {
            id: setInterval(() => {
              for (const direction of nudgeDirections) {
                switch (direction) {
                  case 'up':
                    viewportControls?.nudge('y', VIEWPORT_NUDGE_AMOUNT_PX);
                    break;
                  case 'down':
                    viewportControls?.nudge('y', -1 * VIEWPORT_NUDGE_AMOUNT_PX);
                    break;
                  case 'left':
                    viewportControls?.nudge('x', VIEWPORT_NUDGE_AMOUNT_PX);
                    break;
                  case 'right':
                    viewportControls?.nudge('x', -1 * VIEWPORT_NUDGE_AMOUNT_PX);
                    break;
                }
                onMove(lastScreenPosition!);
              }
            }, VIEWPORT_NUDGE_INTERVAL_MS),
            directions: nudgeDirections,
          };
        }
      }
    }

    // Use client coordinates from the mouse event (consistent with PixiJS FederatedPointerEvent).
    onMove(screenPosition);
  }

  function onWindowMouseUp(e: MouseEvent) {
    if (cancelled) {
      return;
    }
    cancelled = true;

    if (nudgeInterval) {
      clearInterval(nudgeInterval.id);
      nudgeInterval = null;
    }

    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
    onCommit(new ScreenPosition(e.clientX + initialPointerDownOffsetXPx, e.clientY + initialPointerDownOffsetYPx));
  }

  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);

  return {
    destroy() {
      cancelled = true;
      if (nudgeInterval) {
        clearInterval(nudgeInterval.id);
        nudgeInterval = null;
      }
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      onCancel();
    },
  };
}
