import { CM_TO_PIXELS } from "../sheet/Sheet";

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

/** A rectangle in world coordinates. */
export type RectState = {
  readonly position: WorldPosition;
  readonly width: number;
  readonly height: number;
};

/** Combined state for ViewportControls. */
export type ViewportControlsState = {
  readonly viewport: ViewportState;
  readonly rect: RectState;
  readonly isDragging: boolean;
};

/** Position in viewport (PixiJS) coordinate space. Origin is top-left of viewport. */
export class ViewportPosition {
  readonly type = ViewportPositionType;
  constructor(public x: number, public y: number) {}

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

/** Position in world (document) coordinates. This is the canonical space for modelling geometry. */
export class WorldPosition {
  readonly type = WorldPositionType;
  constructor(public x: number, public y: number) {}

  toViewport(state: ViewportState): ViewportPosition {
    return new ViewportPosition(
      state.position.x + this.x * state.scale,
      state.position.y + this.y * state.scale
    );
  }

  toScreen(state: ViewportState): ScreenPosition {
    const vp = this.toViewport(state);
    return vp.toScreen(state);
  }

  toSheet() {
    return new SheetPosition(this.x / CM_TO_PIXELS, this.y / CM_TO_PIXELS);
  }
}

/** Position in screen pixels. Origin is top-left of the viewport. */
export class ScreenPosition {
  readonly type = ScreenPositionType;
  constructor(public x: number, public y: number) {}

  toWorld(state: ViewportState): WorldPosition {
    return new WorldPosition(
      (this.x - state.position.x) / state.scale,
      (this.y - state.position.y) / state.scale
    );
  }

  toViewport(_state: ViewportState): ViewportPosition {
    return new ViewportPosition(this.x, this.y);
  }
}

/** Position in sheet (centimeter) coordinates. Used for snapping and polygon geometry. */
export class SheetPosition {
  readonly type = SheetPositionType;
  constructor(public x: number, public y: number) {}

  toWorld(cmToPx: number): WorldPosition {
    return new WorldPosition(this.x * cmToPx, this.y * cmToPx);
  }
}
