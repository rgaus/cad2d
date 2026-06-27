import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Datum, DATUM_CIRCLE_RADIUS_PX, DatumComponent } from '@/lib/geometry';
import { ListLayers, RendererLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { DatumCrosshairTexture } from '@/lib/textures';
import { ScreenPosition } from '@/lib/viewport/types';

const DatumMarker: React.FunctionComponent<{ geometry: Datum }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const pos = DatumComponent.get(geometry);
  const x = pos.x * SHEET_UNITS_TO_PIXELS;
  const y = pos.y * SHEET_UNITS_TO_PIXELS;

  // Scale so the sprites stay fixed screen-pixel size regardless of zoom
  const spriteScale = 1 / viewportScale;

  const isSelected = selectedIds.includes(geometry.id);

  const onCirclePointerDown = useCallback(
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

  const markerColor = isSelected ? 0x3399ff : 0x666666;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      const pos = DatumComponent.get(geometry);
      const cx = pos.x * SHEET_UNITS_TO_PIXELS;
      const cy = pos.y * SHEET_UNITS_TO_PIXELS;

      // Circle radius in screen pixels (scale-compensated)
      const circleRadius = DATUM_CIRCLE_RADIUS_PX / viewportScale;

      // Render concentric circle as stroke only
      // Clicking inside of the circle should allow handles inside to be dragged
      graphics.setStrokeStyle({ color: markerColor, width: 3 / viewportScale });
      graphics.circle(cx, cy, circleRadius);
      graphics.stroke();
    },
    [geometry, viewportScale, isSelected, markerColor],
  );

  return (
    <pixiContainer>
      {/* Inner crosshairs */}
      <pixiSprite
        texture={DatumCrosshairTexture.get()}
        x={x}
        y={y}
        anchor={0.5}
        scale={spriteScale}
        tint={markerColor}
      />
      {/* Outer ring - render seperately so clicking ONLY on the stroke triggers a drag. */}
      <pixiGraphics
        draw={draw}
        eventMode={activeTool.type === 'select' ? 'static' : 'none'}
        cursor="pointer"
        onPointerDown={onCirclePointerDown}
      />
    </pixiContainer>
  );
};

export const DatumLayers: ListLayers<Datum, React.ReactNode> = {
  [RendererLayers.Overlays]: (datum) => <DatumMarker geometry={datum} />,
};
