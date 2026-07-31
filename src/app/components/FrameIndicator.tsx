'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { HandleSprites } from '@/components/HandleSprites';
import { LinearResizer } from '@/components/LinearResizer';
import {
  SelectionCornerHandleTexture,
} from '@/lib/textures';
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
  onEdgeResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onCornerHandlePointerDown?: (
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  ) => void;
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
  onEdgeResizerPointerDown,
  onCornerHandlePointerDown,
}: PatternGridFilterIndicatorProps) {
  const vUpperLeft = useMemo(() => upperLeft.toWorld(), [upperLeft]);
  const vLowerRight = useMemo(() => lowerRight.toWorld(), [lowerRight]);

  const lineWidth = lineWidthPx / viewportScale;

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

  const hasResizeHandles =
    typeof onEdgeResizerPointerDown !== 'undefined' ||
    typeof onCornerHandlePointerDown !== 'undefined';

  const cornerPoints = useMemo(
    () => [
      new SheetPosition(upperLeft.x, upperLeft.y), // top-left
      new SheetPosition(lowerRight.x, upperLeft.y), // top-right
      new SheetPosition(lowerRight.x, lowerRight.y), // bottom-right
      new SheetPosition(upperLeft.x, lowerRight.y), // bottom-left
    ],
    [upperLeft, lowerRight],
  );

  // Normalize to ensure upperLeft is the smaller coordinate
  const bottom = new SheetPosition(lowerRight.x, upperLeft.y);
  const leftEnd = new SheetPosition(upperLeft.x, lowerRight.y);

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />

      {hasResizeHandles ? (
        <>
          <LinearResizer
            startPosition={upperLeft}
            endPosition={bottom}
            viewportScale={viewportScale}
            onPointerDown={() => onEdgeResizerPointerDown?.('top')}
          />
          <LinearResizer
            startPosition={bottom}
            endPosition={lowerRight}
            viewportScale={viewportScale}
            onPointerDown={() => onEdgeResizerPointerDown?.('right')}
          />
          <LinearResizer
            startPosition={new SheetPosition(upperLeft.x, lowerRight.y)}
            endPosition={lowerRight}
            viewportScale={viewportScale}
            onPointerDown={() => onEdgeResizerPointerDown?.('bottom')}
          />
          <LinearResizer
            startPosition={upperLeft}
            endPosition={leftEnd}
            viewportScale={viewportScale}
            onPointerDown={() => onEdgeResizerPointerDown?.('left')}
          />

          <HandleSprites
            points={cornerPoints}
            handleTexture={SelectionCornerHandleTexture.get()}
            viewportScale={viewportScale}
            onHandlePointerDown={(_e, index) => {
              switch (index) {
                case 0:
                  return onCornerHandlePointerDown?.('top-left');
                case 1:
                  return onCornerHandlePointerDown?.('top-right');
                case 2:
                  return onCornerHandlePointerDown?.('bottom-right');
                case 3:
                  return onCornerHandlePointerDown?.('bottom-left');
              }
            }}
          />
        </>
      ) : null}
    </>
  );
}
