import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useDraggingShapeState } from '@/hooks/useDraggingShapeState';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingRectangle } from '@/hooks/useWorkingRectangle';
import { type Rectangle } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { Rect, ScreenPosition, SheetPosition } from '@/lib/viewport/types';
import { SelectionBoundingBox } from './SelectionBoundingBox';

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
  const isDragging =
    draggingShapeState?.type === 'rectangle' && draggingShapeState.rectangleId === rectangle.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(rectangle.id);
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.handleRectangleFillPointerDown(e, rectangle.id);
    },
    [activeTool],
  );

  const onFillPointerOver = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.handleGeometryFillEnter(rectangle.id);
    }
  }, [activeTool, rectangle.id]);

  const onFillPointerOut = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.handleGeometryFillLeave(rectangle.id);
    }
  }, [activeTool, rectangle.id]);

  const drawRectangle = useCallback(
    (graphics: Graphics) => {
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
    },
    [rectangle, fill, stroke, viewportScale],
  );

  return (
    <pixiGraphics
      draw={drawRectangle}
      eventMode={isDragging ? 'none' : eventMode}
      onPointerDown={onFillPointerDown}
      onPointerOver={onFillPointerOver}
      onPointerOut={onFillPointerOut}
    />
  );
};

const RectangleOverlay: React.FunctionComponent = () => {
  const { activeTool, viewportControls, geometryStore, viewportScale, sheet } =
    useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const rectangles = useRectangles(geometryStore);
  const selectedRectangles = useMemo(
    () => rectangles.filter((e) => selectedIds.includes(e.id)),
    [rectangles, selectedIds],
  );

  const onCornerHandlePointerDown = useCallback(
    (
      rectangle: Rectangle,
      corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right',
      event: FederatedPointerEvent,
    ) => {
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.handleRectangleCornerHandlePointerDown(event, rectangle.id, corner);
    },
    [activeTool],
  );

  const onLinearResizerPointerDown = useCallback(
    (
      rectangle: Rectangle,
      edge: 'top' | 'bottom' | 'left' | 'right',
      event: FederatedPointerEvent,
    ) => {
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.handleRectangleEdgePointerDown(event, rectangle.id, edge);
    },
    [activeTool],
  );

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

        return (
          <SelectionBoundingBox
            key={rectangle.id}
            boundingBox={boundingBox}
            viewportScale={viewportScale}
            onLinearResizerPointerDown={(edge, e) => onLinearResizerPointerDown(rectangle, edge, e)}
            onCornerHandlePointerDown={(corner, e) =>
              onCornerHandlePointerDown(rectangle, corner, e)
            }
          />
        );
      })}
    </>
  );
};

/** Renders all rectangles currently on the sheet. */
export const RectangleLayers: ListLayers<Rectangle, React.ReactNode> = {
  [RendererLayers.Solids]: (rectangle) => <RectangleSolid rectangle={rectangle} />,
  [RendererLayers.Overlays]: <RectangleOverlay />,
};
