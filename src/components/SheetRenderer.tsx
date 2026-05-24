"use client";

import { useCallback, useState, useEffect } from "react";
import { Graphics } from "pixi.js";
import { type ViewportControlsState } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { SHEET_UNITS_TO_PIXELS, type Sheet } from "@/lib/sheet/Sheet";
import type { UnitFamily } from "@/lib/sheet/Sheet";
import { Length } from "@/lib/units/length";

/**
 * Renders the sheet with a grid that drawing occurs on top of.
 * This entity should be completely passive / not respond to any click events.
 **/
export const SheetRenderer: React.FunctionComponent<{
  sheet: Sheet;
  viewportControlsState: ViewportControlsState;
  canvasDimensions: { width: number; height: number };
}> = ({ sheet, viewportControlsState, canvasDimensions }) => {
  const [sheetUnitFamily, setSheetUnitFamily] = useState<UnitFamily>(sheet.defaultUnitFamily);
  useEffect(() => {
    sheet.on('defaultUnitFamilyChange', setSheetUnitFamily);
    return () => { sheet.off('defaultUnitFamilyChange', setSheetUnitFamily); };
  }, [sheet]);

  const draw = useCallback((graphics: Graphics) => {
    if (!viewportControlsState) {
      return;
    }

    const scale = viewportControlsState.viewport.scale;
    const vpX = viewportControlsState.viewport.position.x;
    const vpY = viewportControlsState.viewport.position.y;
    const sheetWidth = viewportControlsState.rect.width;
    const sheetHeight = viewportControlsState.rect.height;

    const minInSheetUnits = Math.pow(10, -sheet.unitPlaces);
    const minLength = Length.fromSheetUnits(sheet.defaultUnit, minInSheetUnits);
    const minInGridUnits = sheetUnitFamily === 'metric'
      ? minLength.toCentimeters().magnitude
      : minLength.toInches().magnitude;

    const grid = getGridAtScale(scale, sheetUnitFamily, minInGridUnits);

    const gridToSheetFactor = sheetUnitFamily === 'metric'
      ? Length.centimeters(1).toSheetUnits(sheet.defaultUnit).magnitude
      : Length.inches(1).toSheetUnits(sheet.defaultUnit).magnitude;
    const primaryWorldUnits = grid.primarySheetUnits * gridToSheetFactor * SHEET_UNITS_TO_PIXELS;

    graphics.clear();

    // Draw fill of sheet
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, sheetWidth, sheetHeight);
    graphics.fill();

    // Calculate visible world area for grid culling
    // A point at screen (sx, sy) maps to world: ((sx - vpX) / scale, (sy - vpY) / scale)
    const leftVisible = Math.max(0, -vpX / scale);
    const topVisible = Math.max(0, -vpY / scale);
    const rightVisible = canvasDimensions ? Math.min(sheetWidth, (-vpX + canvasDimensions.width) / scale) : sheetWidth;
    const bottomVisible = canvasDimensions ? Math.min(sheetHeight, (-vpY + canvasDimensions.height) / scale) : sheetHeight;

    // Draw secondary grid lines (only visible ones)
    if (grid.secondarySheetUnits !== null && grid.secondaryPx !== null) {
      const secondaryWorldUnits = grid.secondarySheetUnits * gridToSheetFactor * SHEET_UNITS_TO_PIXELS;
      graphics.setStrokeStyle({ color: 0xdddddd, width: 1 / scale });

      const firstSecondaryX = Math.floor(leftVisible / secondaryWorldUnits) * secondaryWorldUnits;
      for (let x = firstSecondaryX; x <= rightVisible; x += secondaryWorldUnits) {
        if (x >= 0 && x <= sheetWidth) {
          graphics.moveTo(x, Math.max(0, topVisible));
          graphics.lineTo(x, Math.min(sheetHeight, bottomVisible));
        }
      }
      const firstSecondaryY = Math.floor(topVisible / secondaryWorldUnits) * secondaryWorldUnits;
      for (let y = firstSecondaryY; y <= bottomVisible; y += secondaryWorldUnits) {
        if (y >= 0 && y <= sheetHeight) {
          graphics.moveTo(Math.max(0, leftVisible), y);
          graphics.lineTo(Math.min(sheetWidth, rightVisible), y);
        }
      }
      graphics.stroke();
    }

    // Draw primary grid lines (only visible ones)
    graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });

    const firstPrimaryX = Math.floor(leftVisible / primaryWorldUnits) * primaryWorldUnits;
    for (let x = firstPrimaryX; x <= rightVisible; x += primaryWorldUnits) {
      if (x >= 0 && x <= sheetWidth) {
        graphics.moveTo(x, Math.max(0, topVisible));
        graphics.lineTo(x, Math.min(sheetHeight, bottomVisible));
      }
    }
    const firstPrimaryY = Math.floor(topVisible / primaryWorldUnits) * primaryWorldUnits;
    for (let y = firstPrimaryY; y <= bottomVisible; y += primaryWorldUnits) {
      if (y >= 0 && y <= sheetHeight) {
        graphics.moveTo(Math.max(0, leftVisible), y);
        graphics.lineTo(Math.min(sheetWidth, rightVisible), y);
      }
    }
    graphics.stroke();

    // Draw outline of sheet
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, sheetWidth, sheetHeight);
    graphics.stroke();
  }, [viewportControlsState, canvasDimensions, sheetUnitFamily, sheet]);

  return (
    <pixiGraphics draw={draw} eventMode="none" />
  );
};
