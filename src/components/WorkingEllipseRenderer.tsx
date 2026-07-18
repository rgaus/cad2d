import { Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useWorkingEllipse } from '@/hooks/useWorkingEllipse';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';

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
