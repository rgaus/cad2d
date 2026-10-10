/** The color used to highlight the polygon's open dividing segment. Lives in a dependency-free
 * module so that both the selection layer and the entity layer (which builds the polygon
 * selection-inspector fields) can reference it without creating an import cycle. */
export const POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR = 'var(--teal-10)';
