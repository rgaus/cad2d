"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FederatedPointerEvent, Graphics } from "pixi.js";
import { Rect, ScreenPosition, SheetPosition } from "@/lib/viewport/types";
import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";
import { type Ellipse } from "@/lib/geometry";
import { useViewportContext } from "@/contexts/viewport-context";
import { ListLayers, RendererLayers, SingleLayers } from "@/lib/renderer";
import { SelectionBoundingBox } from "./SelectionBoundingBox";
import { GeometryStore } from "@/lib/geometry/GeometryStore";
import { useWorkingEllipse } from "@/hooks/useWorkingEllipse";
import { useDraggingShapeState } from "@/hooks/useDraggingShapeState";
import { useSelectionManagerSelectedIds } from "@/hooks/useSelectionManagerSelectedIds";

/** Render the currently being drawn ellipse, or nothing is no ellipse is being drawn. */
export const WorkingEllipseRenderer: React.FunctionComponent = () => {
  const { viewportScale } = useViewportContext();
  const workingEllipse = useWorkingEllipse();

  const firstPoint = workingEllipse?.firstPoint ?? null;
  const previewPoint = workingEllipse?.previewPoint ?? null;

  const center = firstPoint !== null && previewPoint !== null
    ? (workingEllipse?.isCenterMode
      ? firstPoint
      : new SheetPosition(
          (Math.min(firstPoint.x, previewPoint.x) + Math.max(firstPoint.x, previewPoint.x)) / 2,
          (Math.min(firstPoint.y, previewPoint.y) + Math.max(firstPoint.y, previewPoint.y)) / 2,
        ))
    : new SheetPosition(0, 0);

  const radiusX = firstPoint !== null && previewPoint !== null
    ? (workingEllipse?.isCenterMode
      ? Math.abs(previewPoint.x - firstPoint.x)
      : (Math.max(firstPoint.x, previewPoint.x) - Math.min(firstPoint.x, previewPoint.x)) / 2)
    : 0;

  const radiusY = firstPoint !== null && previewPoint !== null
    ? (workingEllipse?.isCenterMode
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

  if (firstPoint === null || previewPoint === null) {
    return null;
  }

  return (
    <pixiGraphics draw={drawWorkingEllipse} />
  );
};

/** Renders the "working ellipse" - the ellipse currently being created by the user when using the
 * ellipse tool. */
export const WorkingEllipseLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingEllipseRenderer />,
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
  } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const ellipses = useEllipses(geometryStore);
  const selectedEllipses = useMemo(() => ellipses.filter(e => selectedIds.includes(e.id)), [ellipses, selectedIds]);

  const onCornerHandlePointerDown = useCallback((ellipse: Ellipse, corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
    if (activeTool.type !== "select") {
      return;
    }
    if (!viewportControls) {
      return;
    }
    activeTool.onEllipseCornerHandlePointerDown?.(
      viewportControls,
      ellipse.id,
      corner,
    );
  }, [activeTool, viewportControls]);

  const onLinearResizerPointerDown = useCallback((ellipse: Ellipse, edge: 'top' | 'bottom' | 'left' | 'right') => {
    if (activeTool.type !== "select") {
      return;
    }
    if (!viewportControls) {
      return;
    }
    activeTool.onEllipseEdgePointerDown?.(
      viewportControls,
      ellipse.id,
      edge,
    );
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

        return (
          <SelectionBoundingBox
            key={ellipse.id}
            boundingBox={boundingBox}
            viewportScale={viewportScale}
            onLinearResizerPointerDown={(edge) => onLinearResizerPointerDown(ellipse, edge)}
            onCornerHandlePointerDown={(edge) => onCornerHandlePointerDown(ellipse, edge)}
          />
        );
      })}
    </>
  );
};

/** Renders all ellipses currently on the sheet. */
export const EllipseLayers: ListLayers<Ellipse, React.ReactNode> = {
  [RendererLayers.Solids]: (ellipse) => <EllipseSolid ellipse={ellipse} />,
  [RendererLayers.Overlays]: <EllipseOverlay />,
};
