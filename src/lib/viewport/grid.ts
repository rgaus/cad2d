/** Minimum pixel spacing for primary grid lines. */
export const MIN_PRIMARY_PX = 64;
/** Conversion factor: centimeters to pixels. */
export const CM_TO_PX = 64;

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
  primaryCm: number;
  secondaryCm: number | null;
  primaryPx: number;
  secondaryPx: number | null;
};

/**
 * Returns the ideal grid spacing for the given viewport scale.
 * Finds the nearest grid stop based on the ideal cm per MIN_PRIMARY_PX.
 */
export function getGridAtScale(scale: number): GridSpacing {
  const idealCm = MIN_PRIMARY_PX / (CM_TO_PX * scale);

  let nearestIdx = 0;
  let minDiff = Math.abs(GRID_STOPS_CM[0][0] - idealCm);
  for (let i = 1; i < GRID_STOPS_CM.length; i++) {
    const diff = Math.abs(GRID_STOPS_CM[i][0] - idealCm);
    if (diff < minDiff) {
      minDiff = diff;
      nearestIdx = i;
    }
  }

  const nearest = GRID_STOPS_CM[nearestIdx];

  const primaryCm = nearest[0];
  const secondaryCm = nearest[1];

  return {
    primaryCm,
    secondaryCm,
    primaryPx: primaryCm * CM_TO_PX * scale,
    secondaryPx: secondaryCm !== null ? secondaryCm * CM_TO_PX * scale : null,
  };
}
