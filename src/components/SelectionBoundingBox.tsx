import { Graphics } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { OrientedBoundingBox } from '@/lib/math';
import { drawRotatedRectangle } from '@/lib/pixi-render-helpers';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SELECTION_COLOR, SelectionCornerHandleTexture } from '@/lib/textures';
import { SELECTED_OUTSET_PX } from '@/lib/tools/SelectTool';
import { OrientedRect, SheetPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';
import { LinearResizer } from './LinearResizer';

type SelectionBoundingBoxProps = {
  boundingBox: OrientedRect<SheetPosition>;
  viewportScale: number;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onCornerHandlePointerDown?: (
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  ) => void;
};

/** A utility for rendering a selection bounding box around a geometry given the geometry's
 * `boundingBox`. Edges and corners of this bounding box are resizable. */
export const SelectionBoundingBox: React.FunctionComponent<SelectionBoundingBoxProps> = ({
  boundingBox,
  viewportScale,
  onLinearResizerPointerDown,
  onCornerHandlePointerDown,
}) => {
  const outsetBoundingBox = useMemo(
    () =>
      OrientedBoundingBox.inset(
        boundingBox,
        -1 * (SELECTED_OUTSET_PX / SHEET_UNITS_TO_PIXELS / viewportScale),
      ),
    [boundingBox, viewportScale],
  );
  const polygonBoundsCorners = useMemo(
    () => OrientedBoundingBox.corners(outsetBoundingBox),
    [outsetBoundingBox],
  );
  const polygonBoundsPoints = useMemo(
    () => OrientedBoundingBox.cornersToArray(outsetBoundingBox),
    [outsetBoundingBox],
  );

  const drawPolygonSelection = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      graphics.setStrokeStyle({ color: SELECTION_COLOR, width: 1 / viewportScale });
      drawRotatedRectangle(
        graphics,
        outsetBoundingBox.position,
        new SheetPosition(
          outsetBoundingBox.position.x + outsetBoundingBox.width,
          outsetBoundingBox.position.y + outsetBoundingBox.height,
        ),
        outsetBoundingBox.angleDegrees,
      );
      graphics.stroke();
    },
    [outsetBoundingBox, viewportScale],
  );

  return (
    <pixiContainer>
      <pixiGraphics draw={drawPolygonSelection} eventMode="none" />

      <LinearResizer
        startPosition={polygonBoundsCorners.upperLeft}
        endPosition={polygonBoundsCorners.upperRight}
        viewportScale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('top')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.upperRight}
        endPosition={polygonBoundsCorners.lowerRight}
        viewportScale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('right')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.lowerLeft}
        endPosition={polygonBoundsCorners.lowerRight}
        viewportScale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('bottom')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.upperLeft}
        endPosition={polygonBoundsCorners.lowerLeft}
        viewportScale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('left')}
      />

      <HandleSprites
        points={polygonBoundsPoints}
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
    </pixiContainer>
  );
};
