/** Pixels within which a click registers as "on" a handle to close polygon. */
export const SNAP_THRESHOLD_PX = 16;

/**
 * Screen-pixel radius within which a tap is considered to be on the polygon's closing handle.
 * Kept intentionally smaller than {@link SNAP_THRESHOLD_PX} so that taps meant to place a new
 * point a short distance from the closing vertex are not mistaken for a close.
 */
export const CLOSE_POLYGON_TAP_THRESHOLD_PX = 12;

/** Minimum distance between polygon points to register a new point. */
export const MIN_POINT_DISTANCE_PX = 8;

/** The pixels offset the selected bounding box is rendered from the actual bounding box. */
export const SELECTED_OUTSET_PX = 16;
