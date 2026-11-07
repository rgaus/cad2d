import { useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useGeometries } from '@/hooks/useEntities';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { AnchorPointComponent, Entity, GeometryComponent } from '@/lib/entity';
import { AnchorPointHandleTexture } from '@/lib/textures';
import { ScreenPosition } from '@/lib/viewport/types';
import { HandleSprites } from './HandleSprites';

/** Overlay that renders a draggable anchor point handle on top of every selected geometry which has
 * an {@link AnchorPointComponent}. */
export const AnchorPointOverlay: React.FunctionComponent = () => {
  const { activeTool, viewportControls, geometryStore, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();
  const geometries = useGeometries(geometryStore);

  const handles = useMemo(
    () =>
      geometries.flatMap((geometry) => {
        if (!selectedIds.includes(geometry.id)) {
          return [];
        }
        if (!Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
          return [];
        }
        return [
          {
            id: geometry.id,
            position: AnchorPointComponent.getHandlePosition(geometry),
          },
        ];
      }),
    [geometries, selectedIds],
  );

  if (activeTool.type !== 'select' || handles.length === 0) {
    return null;
  }

  return (
    <HandleSprites
      points={handles.map((handle) => handle.position)}
      handleTexture={AnchorPointHandleTexture.get()}
      viewportScale={viewportScale}
      onHandlePointerDown={(e, index) => {
        const handle = handles[index];
        if (!handle || !viewportControls) {
          return;
        }
        activeTool.onAnchorPointPointerDown(
          new ScreenPosition(e.clientX, e.clientY),
          viewportControls,
          handle.id,
        );
      }}
    />
  );
};
