import { SHEET_UNITS_TO_PIXELS } from "../sheet/Sheet";

/** Minimum pixel spacing for primary grid lines. */
export const MIN_PRIMARY_PX = 64;

/** A set of pairs of (primary cm, secondary cm) when rendering grid lines. */
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

// export const GRID_STOPS_IN = [
//   12,
//   6,
//   3,
//   1,
//   0.5,
//   0.25,
//   0.125,
//   0.0625,
//   0.03125,
// ];

/** Grid spacing result for a given scale. */
export type GridSpacing = {
  primarySheetUnits: number;
  secondarySheetUnits: number | null;
  primaryPx: number;
  secondaryPx: number | null;
};

/**
 * Returns the ideal grid spacing for the given viewport scale.
 * Finds the nearest grid stop based on the ideal cm per MIN_PRIMARY_PX.
 */
export function getGridAtScale(scale: number): GridSpacing {
  const idealInSheetUnits = MIN_PRIMARY_PX / (SHEET_UNITS_TO_PIXELS * scale);

  let nearestIdx = 0;
  let minDiff = Math.abs(GRID_STOPS_CM[0][0] - idealInSheetUnits);
  for (let i = 1; i < GRID_STOPS_CM.length; i++) {
    const diff = Math.abs(GRID_STOPS_CM[i][0] - idealInSheetUnits);
    if (diff < minDiff) {
      minDiff = diff;
      nearestIdx = i;
    }
  }

  const nearest = GRID_STOPS_CM[nearestIdx];

  const primarySheetUnits = nearest[0];
  const secondarySheetUnits = nearest[1];

  return {
    primarySheetUnits,
    secondarySheetUnits,
    primaryPx: primarySheetUnits * SHEET_UNITS_TO_PIXELS * scale,
    secondaryPx: secondarySheetUnits !== null ? secondarySheetUnits * SHEET_UNITS_TO_PIXELS * scale : null,
  };
}
