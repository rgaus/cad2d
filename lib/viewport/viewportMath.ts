import { ViewportPosition, WorldPosition, ScreenPosition, type ViewportState } from './types';

export function screenToWorld(screenPos: ScreenPosition, state: ViewportState): WorldPosition {
  return new WorldPosition(
    (screenPos.x - state.position.x) / state.scale,
    (screenPos.y - state.position.y) / state.scale
  );
}

export function screenToViewport(screenPos: ScreenPosition, state: ViewportState): ViewportPosition {
  return new ViewportPosition(screenPos.x, screenPos.y);
}

export function worldToViewport(worldPos: WorldPosition, state: ViewportState): ViewportPosition {
  return new ViewportPosition(
    state.position.x + worldPos.x * state.scale,
    state.position.y + worldPos.y * state.scale
  );
}

export function viewportToWorld(viewportPos: ViewportPosition, state: ViewportState): WorldPosition {
  return new WorldPosition(
    (viewportPos.x - state.position.x) / state.scale,
    (viewportPos.y - state.position.y) / state.scale
  );
}

export function computeInitialViewportState(
  canvasWidth: number,
  canvasHeight: number,
  rectWidth: number,
  rectHeight: number,
  initialRectWorldPos: WorldPosition = new WorldPosition(0, 0)
): ViewportState {
  const scale = 1;
  const vpX = canvasWidth / 2 - (initialRectWorldPos.x + rectWidth / 2) * scale;
  const vpY = canvasHeight / 2 - (initialRectWorldPos.y + rectHeight / 2) * scale;
  return {
    position: new ViewportPosition(vpX, vpY),
    scale,
  };
}

export function zoomAroundScreenPoint(
  currentState: ViewportState,
  screenPoint: ScreenPosition,
  newScale: number
): ViewportState {
  const worldUnderCursor = screenToWorld(screenPoint, currentState);
  const newVpX = screenPoint.x - worldUnderCursor.x * newScale;
  const newVpY = screenPoint.y - worldUnderCursor.y * newScale;
  return {
    position: new ViewportPosition(newVpX, newVpY),
    scale: newScale,
  };
}
