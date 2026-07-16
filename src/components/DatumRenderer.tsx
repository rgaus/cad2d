import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingDatum } from '@/hooks/useWorkingDatum';
import { DATUM_CIRCLE_RADIUS_PX, Datum, DatumComponent } from '@/lib/geometry';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { DatumCrosshairTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { ScreenPosition } from '@/lib/viewport/types';

const DatumMarker: React.FunctionComponent<{ geometry: Datum }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const pos = DatumComponent.get(geometry);
  const x = pos.x * SHEET_UNITS_TO_PIXELS;
  const y = pos.y * SHEET_UNITS_TO_PIXELS;

  // Scale so the sprites stay fixed screen-pixel size regardless of zoom
  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);

  const isSelected = selectedIds.includes(geometry.id);

  const onOuterRingPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (!viewportControls) {
        return;
      }
      activeTool.handleGeometryFillPointerDown?.(
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
        onPointerDown={onOuterRingPointerDown}
      />
    </pixiContainer>
  );
};

export const DatumLayers: ListLayers<Datum, React.ReactNode> = {
  [RendererLayers.Overlays]: (datum) => <DatumMarker geometry={datum} />,
};

const WorkingDatumPreview: React.FunctionComponent = () => {
  const { viewportScale } = useViewportContext();
  const workingDatum = useWorkingDatum();
  if (!workingDatum) {
    return null;
  }

  const x = workingDatum.position.x * SHEET_UNITS_TO_PIXELS;
  const y = workingDatum.position.y * SHEET_UNITS_TO_PIXELS;
  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);
  const circleRadius = DATUM_CIRCLE_RADIUS_PX / viewportScale;

  return (
    <pixiContainer alpha={0.5}>
      <pixiSprite
        texture={DatumCrosshairTexture.get()}
        x={x}
        y={y}
        anchor={0.5}
        scale={spriteScale}
        tint={0x666666}
      />
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.setStrokeStyle({ color: 0x666666, width: 3 / viewportScale });
          g.circle(x, y, circleRadius);
          g.stroke();
        }}
      />
    </pixiContainer>
  );
};

export const WorkingDatumLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingDatumPreview />,
};
