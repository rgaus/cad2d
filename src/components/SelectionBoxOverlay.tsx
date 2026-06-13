import { useCallback } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { Geometry, type Id } from '@/lib/geometry';
import type { ResizeMode } from '@/lib/geometry/types';
import { unionBoundingBox } from '@/lib/math/bounding-box';
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
