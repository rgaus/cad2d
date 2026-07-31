'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import {
  PatternGridFilterIconTexture,
  SPRITE_SCALE_FACTOR,
} from '@/lib/textures';
import { SheetPosition, WorldPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type PatternGridFilterIndicatorProps = {
  upperLeft: SheetPosition;
  lowerRight?: SheetPosition;
  viewportScale: number;
  isHovered?: boolean;
  color?: number;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const ICON_OFFSET_PX = 12;

/** Renders a grid pattern filter indicator with a bounding rectangle, a clickable icon,
 * and resizable edge/corner handles when callbacks are provided. */
export default function PatternGridFilterIndicator({
  upperLeft,
  viewportScale,
  isHovered,
  color = 0x666666,
  lowerRight,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: PatternGridFilterIndicatorProps) {
  const vUpperLeft = useMemo(() => upperLeft.toWorld(), [upperLeft]);
  const vLowerRight = useMemo(() => lowerRight?.toWorld(), [lowerRight]);

  // Icon at midpoint of the bounding rect, offset upward
  const iconPos = useMemo(() => {
    return Vector2.add(
      vUpperLeft,
      new WorldPosition(-ICON_OFFSET_PX / viewportScale, -ICON_OFFSET_PX / viewportScale),
    );
  }, [vUpperLeft, viewportScale]);

  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      if (!isHovered || !vLowerRight) {
        return;
      }

      graphics.setStrokeStyle({ color, width: 2 / viewportScale });

      const x = vUpperLeft.x;
      const y = vUpperLeft.y;
      const w = vLowerRight.x - vUpperLeft.x;
      const h = vLowerRight.y - vUpperLeft.y;

      graphics.rect(x, y, w, h);
      graphics.stroke();
    },
    [vUpperLeft, vLowerRight, isHovered, color, viewportScale],
  );

  return (
    <>
      {isHovered ? (
        <pixiGraphics draw={draw} />
      ) : null}

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
