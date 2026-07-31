'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { SheetPosition } from '@/lib/viewport/types';

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
};

const LINE_WIDTH_PX = 1;

/** Renders a grid pattern filter indicator with a bounding rectangle, a clickable icon,
 * and resizable edge/corner handles when callbacks are provided. */
export default function FrameIndicator({
  upperLeft,
  lowerRight,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  onPointerDown,
  onPointerUp,
}: PatternGridFilterIndicatorProps) {
  const vUpperLeft = useMemo(() => upperLeft.toWorld(), [upperLeft]);
  const vLowerRight = useMemo(() => lowerRight.toWorld(), [lowerRight]);

  const lineWidth = lineWidthPx / viewportScale;

  const eventMode = onPointerDown || onPointerUp ? 'static' : 'none';

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
      if (eventMode === 'static') {
        graphics.fill({ color: 0xffffff, alpha: 0 });
      }
    },
    [vUpperLeft, vLowerRight, color, lineWidth, eventMode],
  );

  return (
    <pixiGraphics
      draw={draw}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      eventMode={eventMode}
    />
  );
}
