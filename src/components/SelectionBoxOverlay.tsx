import { Graphics } from 'pixi.js';
import { useCallback, useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Geometry } from '@/lib/geometry';
import { unionBoundingBox } from '@/lib/math/bounding-box';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SELECTION_COLOR } from '@/lib/textures';
import { Rect, SheetPosition } from '@/lib/viewport/types';
import { SelectionBoundingBox } from './SelectionBoundingBox';

/** Overlay that renders the selection bounding box(es) for selected geometries.
 *
 * Both single and multi-selection uses the same resize handler, which accepts
 * an array of geometry IDs. Individual geometry hints are rendered as
 * outside-aligned strokes by the geometry solid renderers. */
export const SelectionBoxOverlay: React.FunctionComponent = () => {
  const { activeTool, geometryStore, viewportScale, viewportControls } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const [dragSelectBoundingBox, setDragSelectBoundingBox] = useState<Rect<SheetPosition> | null>(
    null,
  );
  useEffect(() => {
    if (activeTool.type !== 'select') {
      return;
    }

    activeTool.on('dragSelectBoundingBoxChange', setDragSelectBoundingBox);
    return () => {
      activeTool.off('dragSelectBoundingBoxChange', setDragSelectBoundingBox);
    };
  }, [activeTool]);

  const onCornerHandlePointerDown = useCallback(
    (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
      if (viewportControls && activeTool.type === 'select') {
        activeTool.onGeometryResizePointerDown?.(viewportControls, selectedIds.slice(), {
          type: 'corner',
          corner,
        });
      }
    },
    [selectedIds, viewportControls, activeTool],
  );

  const onLinearResizerPointerDown = useCallback(
    (edge: 'top' | 'bottom' | 'left' | 'right') => {
      if (viewportControls && activeTool.type === 'select') {
        activeTool.onGeometryResizePointerDown?.(viewportControls, selectedIds.slice(), {
          type: 'edge',
          edge,
        });
      }
    },
    [selectedIds, viewportControls, activeTool],
  );

  const drawSelectionBounds = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!viewportControls || !dragSelectBoundingBox) {
        return;
      }

      graphics.setStrokeStyle({ color: SELECTION_COLOR, width: 1 / viewportScale });
      graphics.setFillStyle({ color: SELECTION_COLOR, alpha: 0.1 });

      const x = dragSelectBoundingBox.position.x * SHEET_UNITS_TO_PIXELS;
      const y = dragSelectBoundingBox.position.y * SHEET_UNITS_TO_PIXELS;
      const width = dragSelectBoundingBox.width * SHEET_UNITS_TO_PIXELS;
      const height = dragSelectBoundingBox.height * SHEET_UNITS_TO_PIXELS;
      graphics.rect(x, y, width, height);

      graphics.stroke().fill();
    },
    [dragSelectBoundingBox, viewportControls],
  );

  if (activeTool.type !== 'select') {
    return null;
  }

  // Compute the bounding selection volume around all
  const bbox = unionBoundingBox(
    selectedIds.flatMap((id) => {
      const geometry = geometryStore.getById(id);
      if (!geometry) {
        return [];
      }
      let bbox: Rect<SheetPosition>;
      try {
        bbox = Geometry.boundingBox(geometry);
      } catch {
        return [];
      }
      return [bbox];
    }),
  );

  return (
    <>
      {bbox ? (
        <SelectionBoundingBox
          boundingBox={bbox}
          viewportScale={viewportScale}
          onLinearResizerPointerDown={onLinearResizerPointerDown}
          onCornerHandlePointerDown={onCornerHandlePointerDown}
        />
      ) : null}

      {dragSelectBoundingBox ? <pixiGraphics draw={drawSelectionBounds} /> : null}
    </>
  );
};
