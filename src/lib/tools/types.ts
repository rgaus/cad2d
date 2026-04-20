/** Tool types available in the application. */
export type ToolType = 'select' | 'move' | 'polygon';

/** A completed polygon with an id, points, and closed state. */
export type Polygon = {
  id: string;
  points: Array<SheetPosition>;
  closed: boolean;
};

/** A polygon currently being drawn. */
export type WorkingPolygon = {
  points: Array<SheetPosition>;
  previewPoint: SheetPosition | null;
};

import { SheetPosition } from '../viewport/types';
export { SheetPosition };
export type { ScreenPosition } from '../viewport/types';