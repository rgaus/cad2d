import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Geometry } from '@/lib/geometry';
import { Rect, SheetPosition } from '@/lib/viewport/types';
import { SelectionBoundingBox } from './SelectionBoundingBox';
import { unionBoundingBox } from '@/lib/math/bounding-box';

/** Overlay that renders the selection bounding box(es) for selected geometries.
 *
 * When one geometry is selected, renders a single SelectionBoundingBox with resize handles.
 * When multiple geometries are selected, renders a group bounding box (resize handled later).
 * Individual geometry hints are rendered as outside-aligned strokes by the geometry solid
 * renderers. */
export const SelectionBoxOverlay: React.FunctionComponent = () => {
  const { activeTool, geometryStore, viewportScale, viewportControls } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();

  const onCornerHandlePointerDown = useCallback(
    (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => {
      if (selectedIds.length === 1 && viewportControls && activeTool.type === 'select') {
        activeTool.onGeometryResizePointerDown?.(viewportControls, selectedIds[0], {
          type: 'corner',
          corner,
        });
      } else {
        console.warn('multi-geometry-resize', {
          corner,
          selectedIds: selectedIds.slice(),
        });
      }
    },
    [selectedIds, viewportControls, activeTool],
  );

  const onLinearResizerPointerDown = useCallback(
    (edge: 'top' | 'bottom' | 'left' | 'right') => {
      if (selectedIds.length === 1 && viewportControls && activeTool.type === 'select') {
        activeTool.onGeometryResizePointerDown?.(viewportControls, selectedIds[0], {
          type: 'edge',
          edge,
        });
      } else {
        console.warn('multi-geometry-resize', {
          edge,
          selectedIds: selectedIds.slice(),
        });
      }
    },
    [selectedIds, viewportControls, activeTool],
  );

  if (activeTool.type !== 'select' || selectedIds.length === 0) {
    return null;
  }

  // Compute the bounding selection volume around all 
  const bbox = unionBoundingBox(selectedIds.flatMap((id) => {
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
  }));

  if (!bbox) {
    return null;
  }

  return (
    <SelectionBoundingBox
      boundingBox={bbox}
      viewportScale={viewportScale}
      onLinearResizerPointerDown={onLinearResizerPointerDown}
      onCornerHandlePointerDown={onCornerHandlePointerDown}
    />
  );
};
