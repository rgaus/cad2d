import { ViewportPosition, type ViewportState, WorldPosition } from './types';

/** Computes initial viewport state centered on the given rect at scale 1. */
export function computeInitialViewportState(
  canvasWidth: number,
  canvasHeight: number,
  rectWidth: number,
  rectHeight: number,
  initialRectWorldPos: WorldPosition = new WorldPosition(0, 0),
): ViewportState {
  const scale = 1;
  const vpX = canvasWidth / 2 - (initialRectWorldPos.x + rectWidth / 2) * scale;
  const vpY = canvasHeight / 2 - (initialRectWorldPos.y + rectHeight / 2) * scale;
  return {
    position: new ViewportPosition(vpX, vpY),
    scale,
  };
}
