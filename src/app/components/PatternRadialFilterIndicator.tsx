'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { Vector2 } from '@/lib/math';
import { PatternRadialFilterIconTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { SheetPosition, WorldPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type PatternRadialFilterIndicatorProps = {
  center: SheetPosition;
  radius: number;
  repeats: { type: 'count'; count: number };
  viewportScale: number;
  color?: number;
  lineWidthPx?: number;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const ICON_OFFSET_PX = 16;

/** Renders a radial pattern filter indicator with a pie-slice wedge geometry and a clickable icon
 * offset upward from the center point. */
export default function PatternRadialFilterIndicator({
  center,
  radius,
  repeats,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: PatternRadialFilterIndicatorProps) {
  const vCenter = useMemo(() => center.toWorld(), [center]);

  // The two corner points where the pie-slice sides meet the base arc
  const corners = useMemo(() => {
    return PatternFilter.getRadialCornerPoints({
      mode: 'radial',
      center,
      radius,
      repeats,
    });
  }, [center, radius, repeats]);

  const vLeftCorner = useMemo(() => corners[0].toWorld(), [corners]);
  const vRightCorner = useMemo(() => corners[1].toWorld(), [corners]);

  // Icon offset upward from center (opposite to pie opening direction)
  const iconPos = useMemo(() => {
    return Vector2.sub(vCenter, new WorldPosition(0, -ICON_OFFSET_PX / viewportScale));
  }, [vCenter, viewportScale]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setStrokeStyle({ color, width: lineWidth });

      // Draw wedge outline: center -> right corner -> left corner -> center
      graphics.moveTo(vCenter.x, vCenter.y);
      graphics.lineTo(vRightCorner.x, vRightCorner.y);
      graphics.lineTo(vLeftCorner.x, vLeftCorner.y);
      graphics.lineTo(vCenter.x, vCenter.y);
      graphics.stroke();
    },
    [vCenter, vLeftCorner, vRightCorner, color, lineWidth],
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
        texture={PatternRadialFilterIconTexture.get()}
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
