import { useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useRenderableGeometries } from '@/hooks/useEntities';
import { Entity, GeometryComponent } from '@/lib/entity';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SPRITE_SCALE_FACTOR, SnapHintDiamondTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

const ShapsHintOverlaps: React.FunctionComponent = () => {
  const { viewportScale, geometryStore, snapHintsVisibility } = useViewportContext();
  const geometries = useRenderableGeometries(geometryStore);

  const keyPoints = useMemo(() => {
    if (!snapHintsVisibility?.keyPoints) {
      return [];
    }

    const pts: Array<SheetPosition> = [];

    for (const geometry of geometries) {
      const kp = Entity.keyPoints(geometry);
      for (const p of kp.perimeter) {
        pts.push(p);
      }
      for (const p of Object.values(kp.extras)) {
        pts.push(p as SheetPosition);
      }
    }

    return pts;
  }, [snapHintsVisibility, geometries]);

  if (keyPoints.length === 0) {
    return null;
  }

  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);

  return (
    <>
      {keyPoints.map((point, i) => (
        <pixiSprite
          key={i}
          texture={SnapHintDiamondTexture.get()}
          x={point.x * SHEET_UNITS_TO_PIXELS}
          y={point.y * SHEET_UNITS_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode="none"
        />
      ))}
    </>
  );
};

export const SnapsHintLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <ShapsHintOverlaps />,
};
