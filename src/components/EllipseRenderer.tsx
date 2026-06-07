'use client';

import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { Rect, ScreenPosition, SheetPosition } from '@/lib/viewport/types';
import { SelectionBoundingBox } from './SelectionBoundingBox';

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

const useEllipses = (geometryStore: GeometryStore) => {
  const [ellipses, setEllipses] = useState<Array<Ellipse>>([]);
  useEffect(() => {
    const refresh = () => {
      setEllipses(
        Array.from(
          geometryStore.listWithComponents(
            EllipseComponent,
            FillColorComponent,
            LinkDimensionsComponent,
            RenderOrderComponent,
          ),
        ),
      );
    };
    geometryStore.on('geometryAdded', refresh);
    geometryStore.on('geometryUpdated', refresh);
    geometryStore.on('geometryDeleted', refresh);
    return () => {
      geometryStore.off('geometryAdded', refresh);
      geometryStore.off('geometryUpdated', refresh);
      geometryStore.off('geometryDeleted', refresh);
    };
  }, [geometryStore]);
  return ellipses;
};

const EllipseSolid: React.FunctionComponent<{ geometry: Ellipse }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();

  const draggingShapeState = useDraggingShapeState();

  const fill = FillColorComponent.get(geometry) ?? 0xffffff;
  const stroke = 0x000000;
  const isDragging =
    draggingShapeState?.type === 'ellipse' && draggingShapeState.ellipseId === geometry.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(geometry.id);
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (activeTool.type !== 'select') {
        return;
      }
      activeTool.handleEllipseSelect(geometry.id, e.shiftKey);

      if (!viewportControls) {
        return;
      }
      activeTool.onEllipseFillPointerDown?.(
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

      if (fill !== null) {
        graphics.setFillStyle({ color: fill });
        graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
        graphics.fill();
      }

      graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.stroke();
    },
    [geometry, fill, stroke, viewportScale],
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

const EllipseOverlay: React.FunctionComponent = () => {
  const { activeTool, viewportControls, geometryStore, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const ellipses = useEllipses(geometryStore);
  const selectedEllipses = useMemo(
    () => ellipses.filter((e) => selectedIds.includes(e.id)),
    [ellipses, selectedIds],
  );

  const onCornerHandlePointerDown = useCallback(
    (ellipse: Ellipse, corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      activeTool.onEllipseCornerHandlePointerDown?.(viewportControls, ellipse.id, corner);
    },
    [activeTool, viewportControls],
  );

  const onLinearResizerPointerDown = useCallback(
    (ellipse: Ellipse, edge: 'top' | 'bottom' | 'left' | 'right') => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      activeTool.onEllipseEdgePointerDown?.(viewportControls, ellipse.id, edge);
    },
    [activeTool, viewportControls],
  );

  if (activeTool.type !== 'select') {
    return null;
  }

  return (
    <>
      {selectedEllipses.map((geometry) => {
        const ellipseData = EllipseComponent.get(geometry);
        const boundingBox: Rect<SheetPosition> = {
          position: new SheetPosition(
            ellipseData.center.x - ellipseData.radiusX,
            ellipseData.center.y - ellipseData.radiusY,
          ),
          width: ellipseData.radiusX * 2,
          height: ellipseData.radiusY * 2,
        };

        return (
          <SelectionBoundingBox
            key={geometry.id}
            boundingBox={boundingBox}
            viewportScale={viewportScale}
            onLinearResizerPointerDown={(edge) => onLinearResizerPointerDown(geometry, edge)}
            onCornerHandlePointerDown={(edge) => onCornerHandlePointerDown(geometry, edge)}
          />
        );
      })}
    </>
  );
};

/** Renders all ellipses currently on the sheet. */
export const EllipseLayers: ListLayers<Ellipse, React.ReactNode> = {
  [RendererLayers.Solids]: (ellipse) => <EllipseSolid geometry={ellipse} />,
  [RendererLayers.Overlays]: <EllipseOverlay />,
};
