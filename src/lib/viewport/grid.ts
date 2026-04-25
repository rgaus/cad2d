import { SHEET_UNITS_TO_PIXELS, type UnitFamily } from "../sheet/Sheet";

/** Minimum pixel spacing for primary grid lines. */
export const MIN_PRIMARY_PX = 64;

/** A set of pairs of (primary cm, secondary cm) when rendering metric grid lines. */
export const GRID_STOPS_CM: Array<[number, number | null]> = [
  [100, 50],
  [50, 10],
  [20, 5],
  [10, 2],
  [5, 1],
  [2, 0.5],
  [1, 0.2],
  [0.5, 0.1],
  [0.2, 0.05],
  [0.1, 0.02],
  [0.05, 0.01],
  [0.02, 0.01],
  [0.01, null],
];

/** A set of pairs of (primary inches, secondary inches) when rendering SAE grid lines.
 *  Secondary grid lines evenly divide primary grid lines, terminating at 1/64 inch. */
export const GRID_STOPS_IN: Array<[number, number | null]> = [
  [12, 6],
  [3, 1],
  [1, 0.25],
  [0.25, 0.125],
  [0.125, 0.0625],
  [0.0625, 0.03125],
  [0.03125, 0.015625],
  [0.015625, null],
];

/** Grid spacing result for a given scale. */
export type GridSpacing = {
  primarySheetUnits: number;
  secondarySheetUnits: number | null;
  primaryPx: number;
  secondaryPx: number | null;
};

/**
 * Returns the ideal grid spacing for the given viewport scale and unit family.
 * Finds the nearest grid stop based on the ideal sheet units per MIN_PRIMARY_PX.
 * Returns grid values in default sheet units (cm for metric, inches for SAE).
 */
export function getGridAtScale(scale: number, unitFamily: UnitFamily = 'metric'): GridSpacing {
  const stops = unitFamily === 'metric' ? GRID_STOPS_CM : GRID_STOPS_IN;
  const idealInSheetUnits = MIN_PRIMARY_PX / (SHEET_UNITS_TO_PIXELS * scale);

  let nearestIdx = 0;
  let minDiff = Math.abs(stops[0][0] - idealInSheetUnits);
  for (let i = 1; i < stops.length; i++) {
    const diff = Math.abs(stops[i][0] - idealInSheetUnits);
    if (diff < minDiff) {
      minDiff = diff;
      nearestIdx = i;
    }
  }

  const nearest = stops[nearestIdx];

  const primarySheetUnits = nearest[0];
  const secondarySheetUnits = nearest[1];

  return {
    primarySheetUnits,
    secondarySheetUnits,
    primaryPx: primarySheetUnits * SHEET_UNITS_TO_PIXELS * scale,
    secondaryPx: secondarySheetUnits !== null ? secondarySheetUnits * SHEET_UNITS_TO_PIXELS * scale : null,
  };
}
