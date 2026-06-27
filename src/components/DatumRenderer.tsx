import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Datum, DatumComponent } from '@/lib/geometry';
import { DATUM_CIRCLE_RADIUS_PX } from '@/lib/geometry/datum';
import { ListLayers, RendererLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { ScreenPosition } from '@/lib/viewport/types';

const DatumMarker: React.FunctionComponent<{ geometry: Datum }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const isSelected = selectedIds.includes(geometry.id);

  const onPointerDown = useCallback(
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
    [activeTool, geometry.id],
  );

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const pos = DatumComponent.get(geometry);
      const cx = pos.x * SHEET_UNITS_TO_PIXELS;
      const cy = pos.y * SHEET_UNITS_TO_PIXELS;

      // Crosshair line half-length in screen pixels (scale-compensated)
      const chSize = DATUM_CIRCLE_RADIUS_PX / viewportScale;
      // Circle radius in screen pixels (scale-compensated)
      const circleRadius = DATUM_CIRCLE_RADIUS_PX / viewportScale;

      const markerColor = isSelected ? 0x3399ff : 0x666666;

      graphics.setStrokeStyle({ color: markerColor, width: 1 / viewportScale });

      // Crosshair
      graphics.moveTo(cx - chSize, cy);
      graphics.lineTo(cx + chSize, cy);
      graphics.moveTo(cx, cy - chSize);
      graphics.lineTo(cx, cy + chSize);
      graphics.stroke();

      // Concentric circle
      graphics.setStrokeStyle({ color: markerColor, width: 3 / viewportScale });
      // graphics.setFillStyle({ color: 0xffffff, alpha: 0 });
      graphics.circle(cx, cy, circleRadius);
      graphics.stroke();
      // graphics.fill();
    },
    [geometry, viewportScale, isSelected],
  );

  return (
    <pixiGraphics
      draw={draw}
      eventMode={activeTool.type === 'select' ? 'static' : 'none'}
      cursor="pointer"
      onPointerDown={onPointerDown}
    />
  );
};

export const DatumLayers: ListLayers<Datum, React.ReactNode> = {
  [RendererLayers.Overlays]: (datum) => <DatumMarker geometry={datum} />,
};
