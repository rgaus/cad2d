"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EventMode, FederatedPointerEvent, Graphics } from "pixi.js";
import { Rect, ScreenPosition, SheetPosition } from "@/lib/viewport/types";
import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";
import { type WorkingEllipse, type Ellipse } from "@/lib/tools/types";
import DimensionLineConstrait from "@/app/components/DimensionLineConstrait";
import { useDraggingShapeState, useSelectionManagerSelectedIds, useViewportContext } from "@/contexts/viewport-context";
import { LayerListRenderer, RendererLayers } from "@/lib/renderer";
import { SelectionBoundingBox } from "./SelectionBoundingBox";
import { GeometryStore } from "@/lib/tools/GeometryStore";

type WorkingEllipseRendererProps = {
  workingEllipse: WorkingEllipse;
  viewportScale: number;
};

/** Render the currently being drawn ellipse, or nothing is no ellipse is being drawn. */
export const WorkingEllipseRenderer: React.FunctionComponent<WorkingEllipseRendererProps> = ({ workingEllipse, viewportScale }) => {
  const { sheet } = useViewportContext();

  const firstPoint = workingEllipse.firstPoint;
  const previewPoint = workingEllipse.previewPoint;
  const isReady = firstPoint !== null && previewPoint !== null;

  const center = isReady
    ? (workingEllipse.isCenterMode
      ? firstPoint
      : new SheetPosition(
          (Math.min(firstPoint.x, previewPoint.x) + Math.max(firstPoint.x, previewPoint.x)) / 2,
          (Math.min(firstPoint.y, previewPoint.y) + Math.max(firstPoint.y, previewPoint.y)) / 2,
        ))
    : new SheetPosition(0, 0);

  const radiusX = isReady
    ? (workingEllipse.isCenterMode
      ? Math.abs(previewPoint.x - firstPoint.x)
      : (Math.max(firstPoint.x, previewPoint.x) - Math.min(firstPoint.x, previewPoint.x)) / 2)
    : 0;

  const radiusY = isReady
    ? (workingEllipse.isCenterMode
      ? Math.abs(previewPoint.y - firstPoint.y)
      : (Math.max(firstPoint.y, previewPoint.y) - Math.min(firstPoint.y, previewPoint.y)) / 2)
    : 0;

  const centerX = center.x * SHEET_UNITS_TO_PIXELS;
  const centerY = center.y * SHEET_UNITS_TO_PIXELS;
  const radiusXPixels = radiusX * SHEET_UNITS_TO_PIXELS;
  const radiusYPixels = radiusY * SHEET_UNITS_TO_PIXELS;

  const drawWorkingEllipse = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
    graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
    graphics.stroke();
  }, [viewportScale, centerX, centerY, radiusXPixels, radiusYPixels]);

  const radiusPointRight = new SheetPosition(center.x + radiusX, center.y);
  const radiusPointTop = new SheetPosition(center.x, center.y - radiusY);

  if (!isReady) {
    return null;
  }

  return (
    <pixiContainer>
      <pixiGraphics draw={drawWorkingEllipse} />
      <DimensionLineConstrait
        key="dim-rx"
        pointA={center}
        pointB={radiusPointRight}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
      <DimensionLineConstrait
        key="dim-ry"
        pointA={center}
        pointB={radiusPointTop}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
    </pixiContainer>
  );
};

const useEllipses = (geometryStore: GeometryStore) => {
  const [ellipses, setEllipses] = useState<Array<Ellipse>>([]);
  useEffect(() => {
    geometryStore.on('ellipsesChanged', setEllipses);
    return () => {
      geometryStore.off('ellipsesChanged', setEllipses);
    };
  }, [geometryStore]);
  return ellipses;
};

const EllipseSolid: React.FunctionComponent<{ ellipse: Ellipse }> = ({ ellipse }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();

  const draggingShapeState = useDraggingShapeState();

  const fill = ellipse.fillColor ?? 0xffffff;
  const stroke = 0x000000;
  const isDragging = draggingShapeState?.type === 'ellipse' && draggingShapeState.ellipseId === ellipse.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(ellipse.id);
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback((e: FederatedPointerEvent) => {
    if (activeTool.type !== "select") {
      return;
    }
    activeTool.handleEllipseSelect(ellipse.id, e.shiftKey);

    if (!viewportControls) {
      return;
    }
    activeTool.onEllipseFillPointerDown?.(
      new ScreenPosition(e.clientX, e.clientY),
      viewportControls,
      ellipse.id,
    );
  }, [activeTool]);

  const drawEllipse = useCallback((graphics: Graphics) => {
    graphics.clear();

    const centerX = ellipse.center.x * SHEET_UNITS_TO_PIXELS;
    const centerY = ellipse.center.y * SHEET_UNITS_TO_PIXELS;
    const radiusXPixels = ellipse.radiusX * SHEET_UNITS_TO_PIXELS;
    const radiusYPixels = ellipse.radiusY * SHEET_UNITS_TO_PIXELS;

    if (fill !== null) {
      graphics.setFillStyle({ color: fill });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
    graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
    graphics.stroke();
  }, [ellipse, fill, stroke, viewportScale]);

  return (
    <pixiGraphics
      draw={drawEllipse}
      eventMode={isDragging ? 'none' : eventMode}
      onPointerDown={onFillPointerDown}
    />
  );
};

const EllipseOverlay: React.FunctionComponent = () => {
  const {
    activeTool,
    viewportControls,
    geometryStore,
    viewportScale,
    sheet,
  } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const ellipses = useEllipses(geometryStore);
  const selectedEllipses = useMemo(() => ellipses.filter(e => selectedIds.includes(e.id)), [ellipses, selectedIds]);

  const onCornerHandlePointerDown = useCallback((ellipse: Ellipse, corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    if (activeTool.type === "select") {
      if (!viewportControls) {
        return;
      }
      activeTool.onEllipseCornerHandlePointerDown?.(
        viewportControls,
        ellipse.id,
        corner,
      );
    }
  }, [activeTool, viewportControls]);

  const onLinearResizerPointerDown = useCallback((ellipse: Ellipse, edge: 'top' | 'bottom' | 'left' | 'right') => {
    if (activeTool.type === "select") {
      if (!viewportControls) {
        return;
      }
      activeTool.onEllipseEdgePointerDown?.(
        viewportControls,
        ellipse.id,
        edge,
      );
    }
  }, [activeTool, viewportControls]);

  if (activeTool.type !== 'select') {
    return null;
  }

  return (
    <>
      {selectedEllipses.map((ellipse) => {
        const boundingBox: Rect<SheetPosition> = {
          position: new SheetPosition(ellipse.center.x - ellipse.radiusX, ellipse.center.y - ellipse.radiusY),
          width: ellipse.radiusX * 2,
          height: ellipse.radiusY * 2,
        };

        const radiusPointRight = new SheetPosition(ellipse.center.x + ellipse.radiusX, ellipse.center.y);
        const radiusPointTop = new SheetPosition(ellipse.center.x, ellipse.center.y - ellipse.radiusY);

        return (
          <Fragment key={ellipse.id}>
            <SelectionBoundingBox
              boundingBox={boundingBox}
              viewportScale={viewportScale}
              onLinearResizerPointerDown={(edge) => onLinearResizerPointerDown(ellipse, edge)}
              onCornerHandlePointerDown={(edge) => onCornerHandlePointerDown(ellipse, edge)}
            />

            <DimensionLineConstrait
              key="dim-rx"
              pointA={ellipse.center}
              pointB={radiusPointRight}
              viewportScale={viewportScale}
              sheet={sheet}
              offsetPx={16}
            />
            <DimensionLineConstrait
              key="dim-ry"
              pointA={ellipse.center}
              pointB={radiusPointTop}
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

export const EllipseLayers: LayerListRenderer<Ellipse, React.ReactNode> = {
  [RendererLayers.Solids]: (ellipse) => <EllipseSolid ellipse={ellipse} />,
  [RendererLayers.Overlays]: <EllipseOverlay />,
};
