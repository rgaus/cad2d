import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { OrientedBoundingBox } from '@/lib/math';
import { drawRotatedRectangle } from '@/lib/pixi-render-helpers';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SELECTION_COLOR, SelectionCornerHandleTexture } from '@/lib/textures';
import { SELECTED_OUTSET_PX } from '@/lib/tools/SelectTool';
import { OrientedRect, SheetPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';
import { LinearResizer } from './LinearResizer';

/** Length in pixels of the rotation handle tail above the selection box. */
export const ROTATION_HANDLE_TAIL_LENGTH_PX = 24;

type SelectionBoundingBoxProps = {
  boundingBox: OrientedRect<SheetPosition>;
  viewportScale: number;
  showRotationHandle?: boolean;
  showResizeHandles?: boolean;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onCornerHandlePointerDown?: (
    corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
  ) => void;
  onRotationHandlePointerDown?: (event: FederatedPointerEvent) => void;
};

/** A utility for rendering a selection bounding box around a geometry given the geometry's
 * `boundingBox`. Edges and corners of this bounding box are resizable. */
export const SelectionBoundingBox: React.FunctionComponent<SelectionBoundingBoxProps> = ({
  boundingBox,
  viewportScale,
  showRotationHandle,
  showResizeHandles = true,
  onLinearResizerPointerDown,
  onCornerHandlePointerDown,
  onRotationHandlePointerDown,
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

  const rotationHandle = useMemo(() => {
    const topCenter = new SheetPosition(
      (polygonBoundsCorners.upperLeft.x + polygonBoundsCorners.upperRight.x) / 2,
      (polygonBoundsCorners.upperLeft.y + polygonBoundsCorners.upperRight.y) / 2,
    );
    const bottomCenter = new SheetPosition(
      (polygonBoundsCorners.lowerLeft.x + polygonBoundsCorners.lowerRight.x) / 2,
      (polygonBoundsCorners.lowerLeft.y + polygonBoundsCorners.lowerRight.y) / 2,
    );
    const dx = topCenter.x - bottomCenter.x;
    const dy = topCenter.y - bottomCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) {
      return null;
    }

    const tailLength = ROTATION_HANDLE_TAIL_LENGTH_PX / SHEET_UNITS_TO_PIXELS / viewportScale;
    return {
      topCenter,
      tailEnd: new SheetPosition(
        topCenter.x + (dx / distance) * tailLength,
        topCenter.y + (dy / distance) * tailLength,
      ),
    };
  }, [polygonBoundsCorners, viewportScale]);

  const drawRotationTail = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!rotationHandle) {
        return;
      }

      graphics.setStrokeStyle({ color: SELECTION_COLOR, width: 1 / viewportScale });
      graphics.moveTo(
        rotationHandle.topCenter.x * SHEET_UNITS_TO_PIXELS,
        rotationHandle.topCenter.y * SHEET_UNITS_TO_PIXELS,
      );
      graphics.lineTo(
        rotationHandle.tailEnd.x * SHEET_UNITS_TO_PIXELS,
        rotationHandle.tailEnd.y * SHEET_UNITS_TO_PIXELS,
      );
      graphics.stroke();
    },
    [rotationHandle, viewportScale],
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

      {showRotationHandle && rotationHandle ? (
        <>
          <pixiGraphics draw={drawRotationTail} eventMode="none" />
          <HandleSprites
            points={[rotationHandle.tailEnd]}
            handleTexture={SelectionCornerHandleTexture.get()}
            viewportScale={viewportScale}
            onHandlePointerDown={(event) => onRotationHandlePointerDown?.(event)}
          />
        </>
      ) : null}

      {showResizeHandles ? (
        <>
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
        </>
      ) : null}
    </pixiContainer>
  );
};
