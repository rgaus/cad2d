import { cornersToList, rectCorners, rectInset } from "@/lib/math";
import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";
import { getSelectionCornerHandleTexture, SELECTION_COLOR } from "@/lib/textures";
import { SELECTED_OUTSET_PX } from "@/lib/tools/SelectTool";
import { Rect, SheetPosition } from "@/lib/viewport/types";
import { Graphics } from "pixi.js";
import { useCallback, useMemo } from "react";
import { LinearResizer } from "./LinearResizer";
import { HandleSprites } from "./HandleSprites";

type SelectionBoundingBoxProps = {
  boundingBox: Rect<SheetPosition>;
  viewportScale: number;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
};

/** A utility for rendering a selection bounding box around a geometry given the geometry's
  * `boundingBox`. Edges and corners of this bounding box are resizable. */
export const SelectionBoundingBox: React.FunctionComponent<SelectionBoundingBoxProps> = ({
  boundingBox,
  viewportScale,
  onLinearResizerPointerDown,
  onCornerHandlePointerDown,
}) => {
  const polygonBoundsCorners = useMemo(() => rectCorners(
    rectInset(boundingBox, -1 * (SELECTED_OUTSET_PX / SHEET_UNITS_TO_PIXELS / viewportScale))
  ), [boundingBox, viewportScale]);
  const polygonBoundsPoints = useMemo(() => cornersToList(polygonBoundsCorners), [polygonBoundsCorners]);

  const drawPolygonSelection = useCallback((graphics: Graphics) => {
    graphics.clear();

    graphics.setStrokeStyle({ color: SELECTION_COLOR, width: 1 / viewportScale });
    graphics.poly(polygonBoundsPoints.flatMap(p => [
      p.x * SHEET_UNITS_TO_PIXELS,
      p.y * SHEET_UNITS_TO_PIXELS,
    ]));
    graphics.stroke();
  }, [polygonBoundsPoints, viewportScale]);

  return (
    <pixiContainer>
      <pixiGraphics draw={drawPolygonSelection} eventMode="none" />

      <LinearResizer
        startPosition={polygonBoundsCorners.upperLeft}
        endPosition={polygonBoundsCorners.upperRight}
        scale={viewportScale}
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
        handleTexture={getSelectionCornerHandleTexture()}
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
