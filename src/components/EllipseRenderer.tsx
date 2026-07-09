'use client';

import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useDraggingShapeState } from '@/hooks/useDraggingShapeState';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingEllipse } from '@/hooks/useWorkingEllipse';
import {
  type Ellipse,
  EllipseComponent,
  FillColorComponent,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SELECTION_HINT_WIDTH_PX } from '@/lib/textures';
import { ScreenPosition, SheetPosition } from '@/lib/viewport/types';

const CIRCLE_CENTER_MARKER_SIZE_PX = 8;

/** Render the currently being drawn ellipse, or nothing is no ellipse is being drawn. */
export const WorkingEllipseRenderer: React.FunctionComponent = () => {
  const { viewportScale } = useViewportContext();
  const workingEllipse = useWorkingEllipse();

  const firstPoint = workingEllipse?.firstPoint ?? null;
  const previewPoint = workingEllipse?.previewPoint ?? null;

  const center =
    firstPoint !== null && previewPoint !== null
      ? workingEllipse?.isCenterMode
        ? firstPoint
        : new SheetPosition(
            (Math.min(firstPoint.x, previewPoint.x) + Math.max(firstPoint.x, previewPoint.x)) / 2,
            (Math.min(firstPoint.y, previewPoint.y) + Math.max(firstPoint.y, previewPoint.y)) / 2,
          )
      : new SheetPosition(0, 0);

  const radiusX =
    firstPoint !== null && previewPoint !== null
      ? workingEllipse?.isCenterMode
        ? Math.abs(previewPoint.x - firstPoint.x)
        : (Math.max(firstPoint.x, previewPoint.x) - Math.min(firstPoint.x, previewPoint.x)) / 2
      : 0;

  const radiusY =
    firstPoint !== null && previewPoint !== null
      ? workingEllipse?.isCenterMode
        ? Math.abs(previewPoint.y - firstPoint.y)
        : (Math.max(firstPoint.y, previewPoint.y) - Math.min(firstPoint.y, previewPoint.y)) / 2
      : 0;

  const centerX = center.x * SHEET_UNITS_TO_PIXELS;
  const centerY = center.y * SHEET_UNITS_TO_PIXELS;
  const radiusXPixels = radiusX * SHEET_UNITS_TO_PIXELS;
  const radiusYPixels = radiusY * SHEET_UNITS_TO_PIXELS;

  const drawWorkingEllipse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.stroke();
    },
    [viewportScale, centerX, centerY, radiusXPixels, radiusYPixels],
  );

  if (firstPoint === null || previewPoint === null) {
    return null;
  }

  return <pixiGraphics draw={drawWorkingEllipse} />;
};

/** Renders the "working ellipse" - the ellipse currently being created by the user when using the
 * ellipse tool. */
export const WorkingEllipseLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingEllipseRenderer />,
};

const EllipseSolid: React.FunctionComponent<{ geometry: Ellipse }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();

  const draggingShapeState = useDraggingShapeState();

  const fill = FillColorComponent.getOptional(geometry);
  const stroke = 0x000000;
  const isDragging =
    draggingShapeState?.type === 'ellipse' && draggingShapeState.ellipseId === geometry.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(geometry.id);
  const showHintStroke = isSelected && selectedIds.length > 1;
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      activeTool.onGeometryFillPointerDown?.(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        geometry.id,
      );
    },
    [activeTool],
  );

  const onFillPointerOver = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.onEnterGeometryFill(geometry.id);
    }
  }, [activeTool, geometry.id]);

  const onFillPointerOut = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.onLeaveGeometryFill(geometry.id);
    }
  }, [activeTool, geometry.id]);

  const drawEllipse = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const ellipseData = EllipseComponent.get(geometry);
      const centerX = ellipseData.center.x * SHEET_UNITS_TO_PIXELS;
      const centerY = ellipseData.center.y * SHEET_UNITS_TO_PIXELS;
      const radiusXPixels = ellipseData.radiusX * SHEET_UNITS_TO_PIXELS;
      const radiusYPixels = ellipseData.radiusY * SHEET_UNITS_TO_PIXELS;

      if (typeof fill !== 'undefined') {
        if (fill !== null) {
          graphics.setFillStyle({ color: fill });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
        graphics.fill();
      }

      if (showHintStroke) {
        graphics.setStrokeStyle({
          color: stroke,
          width: SELECTION_HINT_WIDTH_PX / viewportScale,
          alpha: 0.3,
          alignment: 1,
        });
        graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: stroke,
        width: 1 / viewportScale,
      });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.stroke();

      // For ellipses that are selected, render a little crosshairs marker at the geometry's center.
      if (isSelected) {
        graphics.setStrokeStyle({ color: 0x666666, width: 1 / viewportScale });
        graphics.moveTo(centerX - CIRCLE_CENTER_MARKER_SIZE_PX / viewportScale, centerY);
        graphics.lineTo(centerX + CIRCLE_CENTER_MARKER_SIZE_PX / viewportScale, centerY);
        graphics.moveTo(centerX, centerY - CIRCLE_CENTER_MARKER_SIZE_PX / viewportScale);
        graphics.lineTo(centerX, centerY + CIRCLE_CENTER_MARKER_SIZE_PX / viewportScale);
        graphics.stroke();
      }
    },
    [geometry, fill, stroke, viewportScale, showHintStroke, isSelected],
  );

  return (
    <pixiGraphics
      draw={drawEllipse}
      eventMode={isDragging ? 'none' : eventMode}
      onPointerDown={onFillPointerDown}
      onPointerOver={onFillPointerOver}
      onPointerOut={onFillPointerOut}
    />
  );
};

/** Renders all ellipses currently on the sheet. */
export const EllipseLayers: ListLayers<Ellipse, React.ReactNode> = {
  [RendererLayers.Solids]: (ellipse) => <EllipseSolid geometry={ellipse} />,
};
