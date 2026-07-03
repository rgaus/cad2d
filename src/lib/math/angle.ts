/** Namespace for angle unit conversion utilities. */
export const Angle = {
  /** Converts degrees to radians. */
  toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  },

  /** Converts radians to degrees. */
  toDegrees(radians: number): number {
    return radians / (Math.PI / 180);
  },
};
