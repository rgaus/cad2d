/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon';

/** A completed polygon with an id, points, and closed state. */
export type Polygon = {
  id: string;
  points: Array<WorldPosition>;
  closed: boolean;
};

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<WorldPosition>;
  previewPoint: WorldPosition | null;
};

import { WorldPosition } from '../viewport/types';
export { WorldPosition };
export type { ScreenPosition } from '../viewport/types';