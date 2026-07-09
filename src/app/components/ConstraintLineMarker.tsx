'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import { CachedIconTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

const LINE_WIDTH_PX = 1;
const ICON_OFFSET_PX = 16;

type ConstraintLineMarkerProps = {
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

/** Renders a line between two points with a circular icon badge offset perpendicular
 *  from the midpoint. Used for horizontal and vertical constraints. */
export default function ConstraintLineMarker({
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
}: ConstraintLineMarkerProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const strokeColor = inConflict ? 0xe5484d : color;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setStrokeStyle({ color: strokeColor, width: lineWidth });
      graphics.moveTo(vA.x, vA.y);
      graphics.lineTo(vB.x, vB.y);
      graphics.stroke();
    },
    [vA, vB, strokeColor, lineWidth],
  );

  // Icon at midpoint, offset perpendicular to the line
  const iconPos = useMemo(() => {
    const midX = (vA.x + vB.x) / 2;
    const midY = (vA.y + vB.y) / 2;
    const dir = Vector2.norm(Vector2.sub(vB, vA));
    const perpX = -dir.y;
    const perpY = dir.x;
    const offset = ICON_OFFSET_PX / viewportScale;
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
