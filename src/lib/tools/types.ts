/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon';

/** A point in world coordinates (without type wrapper for simplicity). */
export type PolygonPoint = {
  x: number;
  y: number;
};

/** A completed polygon with an id, points, and closed state. */
export type Polygon = {
  id: string;
  points: Array<PolygonPoint>;
  closed: boolean;
};

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<PolygonPoint>;
  previewPoint: PolygonPoint | null;
};