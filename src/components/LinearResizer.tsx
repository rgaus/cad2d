import { useMemo } from "react";
import { extend } from "@pixi/react";
import { FederatedPointerEvent, Sprite, Texture } from "pixi.js";
import { SheetPosition } from "@/lib/viewport/types";
import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";

extend({ Sprite });

/** Width in pixels of edge hit detectors for selected polygons (used for resizing handles). */
const LINEAR_RESIZER_WIDTH_PX = 16;

/**
 * Computes the position, length, and angle for rendering a sprite along a line segment.
 * Returns { centerX, centerY, length, angleDegrees } all in pixel coordinates.
 */
function computeLineSpriteTransform(startPosition: SheetPosition, endPosition: SheetPosition): {
  centerX: number;
  centerY: number;
  length: number;
  angleDegrees: number;
} {
  const startX = startPosition.x * SHEET_UNITS_TO_PIXELS;
  const startY = startPosition.y * SHEET_UNITS_TO_PIXELS;
  const endX = endPosition.x * SHEET_UNITS_TO_PIXELS;
  const endY = endPosition.y * SHEET_UNITS_TO_PIXELS;

  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);

  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = angleRadians * (180 / Math.PI);

  return { centerX, centerY, length, angleDegrees };
}

/** A transparent sprite which implements logic to allow a linear edge to be resized in a single
 * axis. Example use case: resizing the edges of rectangles. */
export const LinearResizer: React.FunctionComponent<{
  startPosition: SheetPosition;
  endPosition: SheetPosition;
  viewportScale: number;
  onPointerDown?: (event: FederatedPointerEvent) => void;
}> = ({
  startPosition,
  endPosition,
  viewportScale,
  onPointerDown,
}) => {
  const transform = useMemo(() => {
    return computeLineSpriteTransform(startPosition, endPosition);
  }, [startPosition, endPosition]);

  const cursor = useMemo(() => {
    let normalizedAngleDegrees = transform.angleDegrees;
    while (normalizedAngleDegrees > 360) { normalizedAngleDegrees -= 360; }
    while (normalizedAngleDegrees < 0) { normalizedAngleDegrees += 360; }

    if (normalizedAngleDegrees < 45) {
      return "ns-resize";
    } else if (normalizedAngleDegrees < 90) {
      return "ne-resize";
    } else if (normalizedAngleDegrees < 90+45) {
      return "ew-resize";
    } else if (normalizedAngleDegrees < 180) {
      return "se-resize";
    } else if (normalizedAngleDegrees < 180+45) {
      return "ns-resize";
    } else if (normalizedAngleDegrees < 120) {
      return "sw-resize";
    } else if (normalizedAngleDegrees < 270+45) {
      return "ew-resize";
    } else {
      return "nw-resize";
    }
  }, [transform.angleDegrees]);

  return (
    <pixiSprite
      texture={Texture.WHITE}
      alpha={0}
      x={transform.centerX}
      y={transform.centerY}
      angle={transform.angleDegrees + 90}
      anchor={{ x: 0.5, y: 0.5 }}
      scale={{
        x: LINEAR_RESIZER_WIDTH_PX / viewportScale,
        y: transform.length,
      }}
      eventMode="static"
      cursor={cursor}
      onPointerDown={onPointerDown}
    />
  );
}
