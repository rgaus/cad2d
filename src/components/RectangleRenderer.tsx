import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { FederatedPointerEvent, Graphics } from "pixi.js";
import { Rect, ScreenPosition, SheetPosition } from "@/lib/viewport/types";
import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";
import { type WorkingRectangle, type Rectangle } from "@/lib/tools/types";
import DimensionLineConstrait from "@/app/components/DimensionLineConstrait";
import { useDraggingShapeState, useSelectionManagerSelectedIds, useViewportContext } from "@/contexts/viewport-context";
import { LayerListRenderer, RendererLayers } from "@/lib/renderer";
import { SelectionBoundingBox } from "./SelectionBoundingBox";
import { GeometryStore } from "@/lib/tools/GeometryStore";

type WorkingRectangleRendererProps = {
  workingRectangle: WorkingRectangle;
  viewportScale: number;
};

export const WorkingRectangleRenderer: React.FunctionComponent<WorkingRectangleRendererProps> = ({ workingRectangle, viewportScale }) => {
  const { sheet } = useViewportContext();

  const firstPoint = workingRectangle.firstPoint;
  const previewLowerRight = workingRectangle.previewLowerRight;
  const isReady = firstPoint !== null && previewLowerRight !== null;

  const upperLeft = isReady
    ? (workingRectangle.isCenterMode
      ? new SheetPosition(
          firstPoint.x - (previewLowerRight.x - firstPoint.x),
          firstPoint.y - (previewLowerRight.y - firstPoint.y),
        )
      : new SheetPosition(
          Math.min(firstPoint.x, previewLowerRight.x),
          Math.min(firstPoint.y, previewLowerRight.y),
        ))
    : new SheetPosition(0, 0);

  const lowerRight = isReady
    ? (workingRectangle.isCenterMode
      ? previewLowerRight
      : new SheetPosition(
          Math.max(firstPoint.x, previewLowerRight.x),
          Math.max(firstPoint.y, previewLowerRight.y),
        ))
    : new SheetPosition(0, 0);

  const x = upperLeft.x * SHEET_UNITS_TO_PIXELS;
  const y = upperLeft.y * SHEET_UNITS_TO_PIXELS;
  const width = (lowerRight.x - upperLeft.x) * SHEET_UNITS_TO_PIXELS;
  const height = (lowerRight.y - upperLeft.y) * SHEET_UNITS_TO_PIXELS;

  const drawWorkingRectangle = useCallback((graphics: Graphics) => {
    if (!isReady) return;
    graphics.clear();
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
    graphics.rect(x, y, width, height);
    graphics.stroke();
  }, [viewportScale, isReady, x, y, width, height]);

  const upperRight = new SheetPosition(lowerRight.x, upperLeft.y);
  const lowerLeft = new SheetPosition(upperLeft.x, lowerRight.y);

  if (!isReady) {
    return null;
  }

  return (
    <pixiContainer>
      <pixiGraphics draw={drawWorkingRectangle} />
      <DimensionLineConstrait
        key="dim-width"
        pointA={upperLeft}
        pointB={upperRight}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
      <DimensionLineConstrait
        key="dim-height"
        pointA={upperLeft}
        pointB={lowerLeft}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
    </pixiContainer>
  );
};

const useRectangles = (geometryStore: GeometryStore) => {
  const [rectangles, setRectangles] = useState<Array<Rectangle>>([]);
  useEffect(() => {
    geometryStore.on('rectanglesChanged', setRectangles);
    return () => {
      geometryStore.off('rectanglesChanged', setRectangles);
    };
  }, [geometryStore]);
  return rectangles;
};

const RectangleSolid: React.FunctionComponent<{ rectangle: Rectangle }> = ({ rectangle }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();

  const draggingShapeState = useDraggingShapeState();

  const fill = rectangle.fillColor ?? 0xffffff;
  const stroke = 0x000000;
  const isDragging = draggingShapeState?.type === 'rectangle' && draggingShapeState.rectangleId === rectangle.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(rectangle.id);
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback((e: FederatedPointerEvent) => {
    if (activeTool.type !== "select") {
      return;
    }
    activeTool.handleRectangleSelect(rectangle.id, e.shiftKey);

    if (!viewportControls) {
      return;
    }
    activeTool.onRectangleFillPointerDown?.(
      new ScreenPosition(e.clientX, e.clientY),
      viewportControls,
      rectangle.id,
    );
  }, [activeTool]);

  const drawRectangle = useCallback((graphics: Graphics) => {
    graphics.clear();

    const x = rectangle.upperLeft.x * SHEET_UNITS_TO_PIXELS;
    const y = rectangle.upperLeft.y * SHEET_UNITS_TO_PIXELS;
    const width = (rectangle.lowerRight.x - rectangle.upperLeft.x) * SHEET_UNITS_TO_PIXELS;
    const height = (rectangle.lowerRight.y - rectangle.upperLeft.y) * SHEET_UNITS_TO_PIXELS;

    if (fill !== null) {
      graphics.setFillStyle({ color: fill });
      graphics.rect(x, y, width, height);
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
    graphics.rect(x, y, width, height);
    graphics.stroke();
  }, [rectangle, fill, stroke, viewportScale]);

  return (
    <pixiGraphics
      draw={drawRectangle}
      eventMode={isDragging ? 'none' : eventMode}
      onPointerDown={onFillPointerDown}
    />
  );
};

const RectangleOverlay: React.FunctionComponent = () => {
  const {
    activeTool,
    viewportControls,
    geometryStore,
    viewportScale,
    sheet,
  } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const rectangles = useRectangles(geometryStore);
  const selectedRectangles = useMemo(() => rectangles.filter(e => selectedIds.includes(e.id)), [rectangles, selectedIds]);

  const onCornerHandlePointerDown = useCallback((rectangle: Rectangle, corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    if (activeTool.type !== "select") {
      return;
    }
    if (!viewportControls) {
      return;
    }
    activeTool.onRectangleCornerHandlePointerDown?.(
      viewportControls,
      rectangle.id,
      corner,
    );
  }, [activeTool, viewportControls]);

  const onLinearResizerPointerDown = useCallback((rectangle: Rectangle, edge: 'top' | 'bottom' | 'left' | 'right') => {
    if (activeTool.type !== "select") {
      return;
    }
    if (!viewportControls) {
      return;
    }
    activeTool.onRectangleEdgePointerDown?.(
      viewportControls,
      rectangle.id,
      edge,
    );
  }, [activeTool, viewportControls]);

  if (activeTool.type !== 'select') {
    return null;
  }

  return (
    <>
      {selectedRectangles.map((rectangle) => {
        const boundingBox: Rect<SheetPosition> = {
          position: rectangle.upperLeft,
          width: rectangle.lowerRight.x - rectangle.upperLeft.x,
          height: rectangle.lowerRight.y - rectangle.upperLeft.y,
        };

        const upperLeft = rectangle.upperLeft;
        const upperRight = new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y);
        const lowerLeft = new SheetPosition(rectangle.upperLeft.x, rectangle.lowerRight.y);

        return (
          <Fragment key={rectangle.id}>
            <SelectionBoundingBox
              boundingBox={boundingBox}
              viewportScale={viewportScale}
              onLinearResizerPointerDown={(edge) => onLinearResizerPointerDown(rectangle, edge)}
              onCornerHandlePointerDown={(edge) => onCornerHandlePointerDown(rectangle, edge)}
            />

            <DimensionLineConstrait
              key="dim-width"
              pointA={upperLeft}
              pointB={upperRight}
              viewportScale={viewportScale}
              sheet={sheet}
              offsetPx={16}
            />
            <DimensionLineConstrait
              key="dim-height"
              pointA={upperLeft}
              pointB={lowerLeft}
              viewportScale={viewportScale}
              sheet={sheet}
              offsetPx={16}
            />
          </Fragment>
        );
      })}
    </>
  );
};

export const RectangleLayers: LayerListRenderer<Rectangle, React.ReactNode> = {
  [RendererLayers.Solids]: (rectangle) => <RectangleSolid rectangle={rectangle} />,
  [RendererLayers.Overlays]: <RectangleOverlay />,
};
