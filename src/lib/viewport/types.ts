export const ViewportPositionType = Symbol('viewport-position');
export const WorldPositionType = Symbol('world-position');
export const ScreenPositionType = Symbol('screen-position');

export type ViewportState = {
  readonly position: ViewportPosition;
  readonly scale: number;
};

export type RectState = {
  readonly position: WorldPosition;
  readonly width: number;
  readonly height: number;
};

export type ViewportControlsState = {
  readonly viewport: ViewportState;
  readonly rect: RectState;
  readonly isDragging: boolean;
};

export class ViewportPosition {
  readonly type = ViewportPositionType;
  constructor(public x: number, public y: number) {}

  toWorld(state: ViewportState): WorldPosition {
    return new WorldPosition(
      this.x + (this.x - state.position.x) / state.scale,
      this.y + (this.y - state.position.y) / state.scale
    );
  }

  toScreen(state: ViewportState): ScreenPosition {
    return new ScreenPosition(
      state.position.x + (this.x - state.position.x) * state.scale,
      state.position.y + (this.y - state.position.y) * state.scale
    );
  }
}

export class WorldPosition {
  readonly type = WorldPositionType;
  constructor(public x: number, public y: number) {}

  toViewport(state: ViewportState): ViewportPosition {
    return new ViewportPosition(
      state.position.x + (this.x - state.position.x) * state.scale,
      state.position.y + (this.y - state.position.y) * state.scale
    );
  }

  toScreen(state: ViewportState): ScreenPosition {
    const vp = this.toViewport(state);
    return vp.toScreen(state);
  }
}

export class ScreenPosition {
  readonly type = ScreenPositionType;
  constructor(public x: number, public y: number) {}

  toWorld(state: ViewportState): WorldPosition {
    return new WorldPosition(
      state.position.x + (this.x - state.position.x) / state.scale,
      state.position.y + (this.y - state.position.y) / state.scale
    );
  }

  toViewport(state: ViewportState): ViewportPosition {
    return new ViewportPosition(this.x, this.y);
  }
}
