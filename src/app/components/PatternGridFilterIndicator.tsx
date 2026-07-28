'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import { PatternGridFilterIconTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { SheetPosition, WorldPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type PatternGridFilterIndicatorProps = {
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  viewportScale: number;
  color?: number;
  lineWidthPx?: number;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const ICON_OFFSET_PX = 12;

/** Renders a grid pattern filter indicator with a bounding rectangle and a clickable icon offset
 * upward from the midpoint. */
export default function PatternGridFilterIndicator({
  upperLeft,
  lowerRight,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: PatternGridFilterIndicatorProps) {
  const vUpperLeft = useMemo(() => upperLeft.toWorld(), [upperLeft]);
  const vLowerRight = useMemo(() => lowerRight.toWorld(), [lowerRight]);

  // Icon at midpoint of the bounding rect, offset upward
  const iconPos = useMemo(() => {
    return Vector2.add(
      vUpperLeft,
      new WorldPosition(-ICON_OFFSET_PX / viewportScale, -ICON_OFFSET_PX / viewportScale),
    );
  }, [vUpperLeft, viewportScale]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setStrokeStyle({ color, width: lineWidth });

      const x = vUpperLeft.x;
      const y = vUpperLeft.y;
      const w = vLowerRight.x - vUpperLeft.x;
      const h = vLowerRight.y - vUpperLeft.y;

      graphics.rect(x, y, w, h);
      graphics.stroke();
    },
    [vUpperLeft, vLowerRight, color, lineWidth],
  );

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />

      <pixiSprite
        texture={PatternGridFilterIconTexture.get()}
        x={iconPos.x}
        y={iconPos.y}
        anchor={0.5}
        scale={spriteScale / SPRITE_SCALE_FACTOR}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        eventMode={
          onPointerDown || onPointerUp || onPointerEnter || onPointerLeave ? 'static' : 'none'
        }
      />
    </>
  );
}
