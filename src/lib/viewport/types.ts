import { SHEET_UNITS_TO_PIXELS } from "../sheet/Sheet";

/** Runtime type symbol for ViewportPosition. */
export const ViewportPositionType = Symbol('viewport-position');
/** Runtime type symbol for WorldPosition. */
export const WorldPositionType = Symbol('world-position');
/** Runtime type symbol for ScreenPosition. */
export const ScreenPositionType = Symbol('screen-position');
/** Runtime type symbol for SheetPosition. */
export const SheetPositionType = Symbol('sheet-position');

/** Current viewport transform state. */
export type ViewportState = {
  readonly position: ViewportPosition;
  readonly scale: number;
};

/** A line segment in any coordinate system. */
export type LineSegment<P extends Position> = { start: P; end: P };

/** Type guard to check if a curve is a plain line segment (has neither controlPoint nor controlPointA). */
export function isLineSegment<P extends Position>(c: QuadraticCurve<P> | CubicCurve<P> | LineSegment<P>): c is LineSegment<P> {
  return !('controlPoint' in c) && !('controlPointA' in c);
}

/** A quadratic curve with a single control point. */
export type QuadraticCurve<P extends Position> = { start: P; end: P; controlPoint: P };

/** Type guard to check if a curve is a quadratic Bezier (has controlPoint but not controlPointA). */
export function isQuadraticCurve<P extends Position>(c: QuadraticCurve<P> | CubicCurve<P> | LineSegment<P>): c is QuadraticCurve<P> {
  return 'controlPoint' in c && !('controlPointA' in c);
}

/** A cubic bezier curve with two control points. */
export type CubicCurve<P extends Position> = { start: P; end: P; controlPointA: P; controlPointB: P };

/** Type guard to check if a curve is a cubic Bezier (has controlPointA). */
export function isCubicCurve<P extends Position>(c: QuadraticCurve<P> | CubicCurve<P> | LineSegment<P>): c is CubicCurve<P> {
  return 'controlPointA' in c;
}

/** An axis-aligned rectangle (often used as a bounding box) in any coordinate system. */
export type Rect<P extends Position> = {
  readonly position: P;
  readonly width: number;
  readonly height: number;
};

export type RectCorners<P extends Position> = {
  upperLeft: P;
  upperRight: P;
  lowerLeft: P;
  lowerRight: P;
};

/** Combined state for ViewportControls. */
export type ViewportControlsState = {
  readonly viewport: ViewportState;
  readonly rect: Rect<WorldPosition>;
  readonly isDragging: boolean;
};

export abstract class Position {
  abstract readonly type: symbol;
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
};


/** Position in viewport (PixiJS) coordinate space. Origin is top-left of viewport. */
export class ViewportPosition extends Position {
  readonly type = ViewportPositionType;

  toWorld(state: ViewportState): WorldPosition {
    return new WorldPosition(
      (this.x - state.position.x) / state.scale,
      (this.y - state.position.y) / state.scale
    );
  }

  toScreen(state: ViewportState): ScreenPosition {
    return new ScreenPosition(
      state.position.x + (this.x - state.position.x) * state.scale,
      state.position.y + (this.y - state.position.y) * state.scale
    );
  }
}

/** Position in world (pixels) coordinates. This is the canonical space for modelling geometry. */
export class WorldPosition extends Position {
  readonly type = WorldPositionType;

  toViewport(state: ViewportState): ViewportPosition {
    return new ViewportPosition(
      state.position.x + this.x * state.scale,
      state.position.y + this.y * state.scale
    );
  }

  toScreen(state: ViewportState): ScreenPosition {
    return new ScreenPosition(
      state.position.x + this.x * state.scale,
      state.position.y + this.y * state.scale
    );
  }

  toSheet() {
    return new SheetPosition(this.x / SHEET_UNITS_TO_PIXELS, this.y / SHEET_UNITS_TO_PIXELS);
  }
}

/** Position in screen pixels. Origin is top-left of the viewport. */
export class ScreenPosition extends Position {
  readonly type = ScreenPositionType;

  toWorld(state: ViewportState): WorldPosition {
    return new WorldPosition(
      (this.x - state.position.x) / state.scale,
      (this.y - state.position.y) / state.scale
    );
  }

  toViewport(): ViewportPosition {
    return new ViewportPosition(this.x, this.y);
  }
}

/** Position in sheet (default sheet unit) coordinates. Used for snapping and polygon geometry. */
export class SheetPosition extends Position {
  readonly type = SheetPositionType;

  toWorld(): WorldPosition {
    return new WorldPosition(this.x * SHEET_UNITS_TO_PIXELS, this.y * SHEET_UNITS_TO_PIXELS);
  }
}
