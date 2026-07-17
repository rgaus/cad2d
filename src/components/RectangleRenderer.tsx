import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingRectangle } from '@/hooks/useWorkingRectangle';
import { FillColorComponent, type Rectangle, RectangleComponent } from '@/lib/entity';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import {
  HIGHLIGHT_COLOR_FILL,
  HIGHLIGHT_COLOR_STROKE,
  HIGHLIGHT_STROKE_WIDTH,
  SELECTION_HINT_WIDTH_PX,
} from '@/lib/textures';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';

export const WorkingRectangleRenderer: React.FunctionComponent = () => {
  const { viewportScale } = useViewportContext();
  const workingRectangle = useWorkingRectangle();

  const firstPoint = workingRectangle?.firstPoint ?? null;
  const previewLowerRight = workingRectangle?.previewLowerRight ?? null;

  const upperLeft =
    firstPoint !== null && previewLowerRight !== null
      ? workingRectangle?.isCenterMode
        ? new SheetPosition(
            firstPoint.x - (previewLowerRight.x - firstPoint.x),
            firstPoint.y - (previewLowerRight.y - firstPoint.y),
          )
        : new SheetPosition(
            Math.min(firstPoint.x, previewLowerRight.x),
            Math.min(firstPoint.y, previewLowerRight.y),
          )
      : new SheetPosition(0, 0);

  const lowerRight =
    firstPoint !== null && previewLowerRight !== null
      ? workingRectangle?.isCenterMode
        ? previewLowerRight
        : new SheetPosition(
            Math.max(firstPoint.x, previewLowerRight.x),
            Math.max(firstPoint.y, previewLowerRight.y),
          )
      : new SheetPosition(0, 0);

  const x = upperLeft.x * SHEET_UNITS_TO_PIXELS;
  const y = upperLeft.y * SHEET_UNITS_TO_PIXELS;
  const width = (lowerRight.x - upperLeft.x) * SHEET_UNITS_TO_PIXELS;
  const height = (lowerRight.y - upperLeft.y) * SHEET_UNITS_TO_PIXELS;

  const drawWorkingRectangle = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
      graphics.rect(x, y, width, height);
      graphics.stroke();
    },
    [viewportScale, x, y, width, height],
  );

  if (firstPoint === null || previewLowerRight === null) {
    return null;
  }

  return <pixiGraphics draw={drawWorkingRectangle} />;
};

/** Renders the "working rectangle" - the rectangle currently being created by the user when using the
 * rectangle tool. */
export const WorkingRectangleLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingRectangleRenderer />,
};

const RectangleSolid: React.FunctionComponent<{ geometry: Rectangle }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale, highlightedGeometryId } =
    useViewportContext();

  let fill = FillColorComponent.getOptional(geometry);
  let stroke = 0x000000;
  let strokeWidth = 1;
  if (highlightedGeometryId === geometry.id) {
    fill = HIGHLIGHT_COLOR_FILL;
    stroke = HIGHLIGHT_COLOR_STROKE;
    strokeWidth = HIGHLIGHT_STROKE_WIDTH;
  }

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(geometry.id);
  const showHintStroke = isSelected && selectedIds.length > 1;

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (!viewportControls) {
        return;
      }

      const shouldCancel = activeTool.handleGeometryFillPointerDown(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        geometry.id,
      );

      if (shouldCancel) {
        // Don't trigger handleMouseDown too
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [activeTool],
  );

  const onFillPointerOver = useCallback(() => {
    activeTool.handleGeometryFillEnter(geometry.id);
  }, [activeTool, geometry.id]);

  const onFillPointerOut = useCallback(() => {
    activeTool.handleGeometryFillLeave(geometry.id);
  }, [activeTool, geometry.id]);

  const drawRectangle = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const rectangle = RectangleComponent.get(geometry);

      const x = rectangle.upperLeft.x * SHEET_UNITS_TO_PIXELS;
      const y = rectangle.upperLeft.y * SHEET_UNITS_TO_PIXELS;
      const width = (rectangle.lowerRight.x - rectangle.upperLeft.x) * SHEET_UNITS_TO_PIXELS;
      const height = (rectangle.lowerRight.y - rectangle.upperLeft.y) * SHEET_UNITS_TO_PIXELS;

      if (typeof fill !== 'undefined') {
        if (fill !== null) {
          graphics.setFillStyle({ color: fill });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        graphics.rect(x, y, width, height);
        graphics.fill();
      }

      if (showHintStroke) {
        graphics.setStrokeStyle({
          color: stroke,
          width: SELECTION_HINT_WIDTH_PX / viewportScale,
          alpha: 0.3,
          alignment: 1,
        });
        graphics.rect(x, y, width, height);
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: stroke,
        width: strokeWidth / viewportScale,
      });
      graphics.rect(x, y, width, height);
      graphics.stroke();
    },
    [geometry, fill, stroke, strokeWidth, viewportScale, showHintStroke],
  );

  return (
    <pixiGraphics
      draw={drawRectangle}
      eventMode="static"
      onPointerDown={onFillPointerDown}
      onPointerOver={onFillPointerOver}
      onPointerOut={onFillPointerOut}
    />
  );
};

/** Renders all rectangles currently on the sheet. */
export const RectangleLayers: ListLayers<Rectangle, React.ReactNode> = {
  [RendererLayers.Solids]: (rectangle) => <RectangleSolid geometry={rectangle} />,
};
