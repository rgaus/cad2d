'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import { CachedIconTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

const LINE_WIDTH_PX = 1;
const ICON_OFFSET_PX = 16;

type ConstraintTwoPointMarkerProps = {
  pointA: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  icon: CachedIconTexture;
  conflictIcon: CachedIconTexture;
  color?: number;
  lineWidthPx?: number;
  inConflict?: boolean;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

/** Renders two points which together make up a constraint. Used for coincident constraints. */
export default function ConstraintTwoPointMarker({
  pointA,
  pointB,
  viewportScale,
  icon,
  conflictIcon,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  inConflict = false,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: ConstraintTwoPointMarkerProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);

  const strokeColor = inConflict ? 0xe5484d : color;

  const targetRadius = 4 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setFillStyle({ color: strokeColor });

      graphics.moveTo(vA.x, vA.y);
      graphics.circle(vA.x, vA.y, targetRadius);
      graphics.moveTo(vB.x, vB.y);
      graphics.circle(vB.x, vB.y, targetRadius);
      graphics.fill();

      graphics.setStrokeStyle({ color: strokeColor, width: lineWidth });
      graphics.moveTo(vA.x, vA.y);
      graphics.lineTo(vB.x, vB.y);

      graphics.stroke();
    },
    [vA, vB, strokeColor, lineWidth],
  );

  const iconPos = useMemo(() => {
    const midX = (vA.x + vB.x) / 2;
    const midY = (vA.y + vB.y) / 2;
    const offset = ICON_OFFSET_PX / viewportScale;

    const length = Vector2.distance(vA, vB);
    if (length < 1e-3) {
      // Both points are at the same position, so render always to the right of the shared position
      return { x: midX + offset, y: midY };
    }

    // Length between points, so render in a consistent spot offset from the midpoint
    const dir = Vector2.norm(Vector2.sub(vB, vA));
    const perpX = -dir.y;
    const perpY = dir.x;
    return { x: midX + perpX * offset, y: midY + perpY * offset };
  }, [vA, vB, viewportScale]);

  const activeIcon = inConflict ? conflictIcon : icon;

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />
      <pixiSprite
        texture={activeIcon.get()}
        x={iconPos.x}
        y={iconPos.y}
        anchor={0.5}
        scale={spriteScale}
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
