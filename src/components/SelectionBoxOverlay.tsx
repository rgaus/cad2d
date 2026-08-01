import { Graphics } from 'pixi.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { BoundingBoxVisibleComponent, Entity, GeometryComponent, RenderShape } from '@/lib/entity';
import { BoundingBox } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { SELECTION_COLOR } from '@/lib/textures';
import { SELECTED_OUTSET_PX } from '@/lib/tools/SelectTool';
import { UnitType } from '@/lib/units/length';
import { Rect, SheetPosition } from '@/lib/viewport/types';
import { SelectionBoundingBox } from './SelectionBoundingBox';

/** Overlay that renders the selection bounding box(es) for selected geometries.
 *
 * Both single and multi-selection uses the same resize handler, which accepts
 * an array of geometry IDs. Individual geometry hints are rendered as
 * outside-aligned strokes by the geometry solid renderers. */
export const SelectionBoxOverlay: React.FunctionComponent = () => {
  const { activeTool, geometryStore, viewportScale, viewportControls, filtersByGeometryId, sheet } =
    useViewportContext();
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

  // Compute the bounding selection volume around all visible geometries.
  // Geometries that return false from BoundingBoxVisibleComponent.get (e.g. datums
  // with zero area) are excluded from the union bounding box computation.
  const selectedEntities = selectedIds.flatMap((id) => {
    const geometry = geometryStore.getRenderableGeometryById(id);
    if (!geometry) {
      return [];
    }
    return [geometry];
  });

  // Hide the selection box if all selected geometries don't have a visible bounding box.
  const hideBbox = selectedEntities.every((g) => !BoundingBoxVisibleComponent.get(g));

  const [sheetDefaultUnit, setSheetDefaultUnit] = useState<Sheet['defaultUnit']>(sheet.defaultUnit);
  useEffect(() => {
    const handler = (unit: UnitType) => setSheetDefaultUnit(unit);
    sheet.on('defaultUnitChange', handler);
    return () => {
      sheet.off('defaultUnitChange', handler);
    };
  }, [sheet]);

  const [selectionBbox, selectionOutline] = useMemo(() => {
    if (hideBbox) {
      return [null, null];
    }
    const entityBoundingBoxes = selectedEntities.flatMap(
      (entity): Array<[Rect<SheetPosition> | null, Rect<SheetPosition> | null]> => {
        let bbox: Rect<SheetPosition>;
        try {
          bbox = Entity.boundingBox(entity);
        } catch {
          return [[null, null] as const];
        }

        let outlineBbox = bbox;
        // Take into account any filter-produced render shapes when generating the selection box
        const filters = filtersByGeometryId.get(entity.id) ?? [];
        if (Entity.hasComponent(entity, GeometryComponent) && filters.length > 0) {
          const shapes = GeometryComponent.getRenderShapes(entity, sheetDefaultUnit, filters);
          outlineBbox = BoundingBox.union([
            bbox,
            ...shapes.map((shape) => RenderShape.boundingBox(shape)),
          ])!;
        }

        return [[bbox, outlineBbox] as const];
      },
    );

    const selectionBbox = BoundingBox.union(
      entityBoundingBoxes.flatMap((b) => (b[0] ? [b[0]] : [])),
    );
    const selectionOutline = BoundingBox.union(
      entityBoundingBoxes.flatMap((b) => (b[1] ? [b[1]] : [])),
    );
    return [
      selectionBbox,
      selectionBbox && selectionOutline && !BoundingBox.equals(selectionBbox, selectionOutline)
        ? selectionOutline
        : null,
    ];
  }, [hideBbox, selectedEntities, filtersByGeometryId, sheetDefaultUnit]);

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
      if (!dragSelectBoundingBox) {
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
    [dragSelectBoundingBox],
  );

  const drawSelectionOutline = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      if (!selectionOutline) {
        return;
      }
      const selectionOutlineWithOutset = BoundingBox.inset(
        selectionOutline,
        -1 * (SELECTED_OUTSET_PX / SHEET_UNITS_TO_PIXELS / viewportScale),
      );

      graphics.setStrokeStyle({ color: SELECTION_COLOR, alpha: 0.5, width: 1 / viewportScale });

      const x = selectionOutlineWithOutset.position.x * SHEET_UNITS_TO_PIXELS;
      const y = selectionOutlineWithOutset.position.y * SHEET_UNITS_TO_PIXELS;
      const width = selectionOutlineWithOutset.width * SHEET_UNITS_TO_PIXELS;
      const height = selectionOutlineWithOutset.height * SHEET_UNITS_TO_PIXELS;
      graphics.rect(x, y, width, height);

      graphics.stroke();
    },
    [selectionOutline, viewportScale],
  );

  if (activeTool.type !== 'select') {
    return null;
  }

  return (
    <>
      {/* The selection outline renders around the selected entity and and render shapes */}
      {selectionOutline ? <pixiGraphics draw={drawSelectionOutline} /> : null}

      {/* The selection bounding box renders just around the selected entity. */}
      {selectionBbox ? (
        <SelectionBoundingBox
          boundingBox={selectionBbox}
          viewportScale={viewportScale}
          onLinearResizerPointerDown={onLinearResizerPointerDown}
          onCornerHandlePointerDown={onCornerHandlePointerDown}
        />
      ) : null}

      {dragSelectBoundingBox ? <pixiGraphics draw={drawSelectionBounds} /> : null}
    </>
  );
};
