import { useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useEllipses } from '@/hooks/useEllipses';
import { usePolygons } from '@/hooks/usePolygons';
import { useRectangles } from '@/hooks/useRectangles';
import {
  EllipseComponent,
  type Geometry,
  PolygonComponent,
  RectangleComponent,
} from '@/lib/geometry';
import { RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SPRITE_SCALE_FACTOR, SnapHintDiamondTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

const ShapsHintOverlaps: React.FunctionComponent = () => {
  const { viewportScale, geometryStore, snapHintsVisibility } = useViewportContext();
  const rectangles = useRectangles(geometryStore);
  const ellipses = useEllipses(geometryStore);
  const polygons = usePolygons(geometryStore);

  const keyPoints = useMemo(() => {
    if (!snapHintsVisibility?.keyPoints) {
      return [];
    }

    const pts: Array<SheetPosition> = [];

    for (const rect of rectangles) {
      const kp = RectangleComponent.keyPoints(rect as Geometry<RectangleComponent>);
      for (const p of kp.perimeter) {
        pts.push(p);
      }
      for (const p of Object.values(kp.extras)) {
        pts.push(p);
      }
    }

    for (const ellipse of ellipses) {
      const kp = EllipseComponent.keyPoints(ellipse as Geometry<EllipseComponent>);
      for (const p of kp.perimeter) {
        pts.push(p);
      }
      for (const p of Object.values(kp.extras)) {
        pts.push(p);
      }
    }

    for (const polygon of polygons) {
      const kp = PolygonComponent.keyPoints(polygon as Geometry<PolygonComponent>);
      for (const p of kp.perimeter) {
        pts.push(p);
      }
    }

    return pts;
  }, [snapHintsVisibility, rectangles, ellipses, polygons]);

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
