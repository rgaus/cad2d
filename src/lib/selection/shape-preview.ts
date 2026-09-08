import { Entity, GeometryComponent } from '../entity';
import { Filter } from '../entity/filters';
import { Sheet } from '../sheet/Sheet';

/** A highlight overlay drawn on the {@link ShapePreview} (a point vertex or a polygon segment). */
export type ShapePreviewHighlight =
  | { type: 'point'; index: number; color?: string }
  | { type: 'segment'; index: number; color?: string };

/** The dimension currently being edited (used to draw dimension guide lines on the preview). */
export type ShapePreviewEditingDimension =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'origin'
  | 'radiusX'
  | 'radiusY';

/** The color used to highlight the polygon's open dividing segment. */
export const POLYGON_OPEN_SEGMENT_HIGHLIGHT_COLOR = 'var(--teal-10)';

/**
 * The full state driving the {@link ShapePreview}. `null` indicates no preview should render (no
 * selection, multiple shapes selected, or the single selection is not a renderable shape).
 */
export type ShapePreviewState = {
  geometry: Entity<GeometryComponent>;
  sheetDefaultUnit: Sheet['defaultUnit'];
  filters: Array<Filter>;
  highlight: ShapePreviewHighlight | null;
  editingDimension: ShapePreviewEditingDimension | null;
} | null;
