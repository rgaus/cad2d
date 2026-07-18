import { Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';
import { useWorkingRectangle } from '@/hooks/useWorkingRectangle';

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

