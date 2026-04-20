import {
  ViewportPosition,
  WorldPosition,
  ScreenPosition,
  type ViewportState,
  type RectState,
  type ViewportControlsState,
} from './types';
import {
  computeInitialViewportState,
  zoomAroundScreenPoint,
  screenToWorld,
} from './viewportMath';

const ZOOM_SENSITIVITY = 0.005;

export type ViewportControlsConfig = {
  canvasWidth: number;
  canvasHeight: number;
  rectWidth: number;
  rectHeight: number;
};

export type ViewportControlsEvents = {
  onCursorChange: (cursor: 'grab' | 'grabbing' | 'default') => void;
};

export class ViewportControls {
  private viewport: ViewportState;
  private rect: RectState;
  private isDragging: boolean = false;
  private dragStartMouse: ScreenPosition | null = null;
  private dragStartRect: WorldPosition | null = null;
  private canvasWidth: number;
  private canvasHeight: number;
  private events: ViewportControlsEvents;

  constructor(config: ViewportControlsConfig, events: ViewportControlsEvents) {
    this.canvasWidth = config.canvasWidth;
    this.canvasHeight = config.canvasHeight;
    this.events = events;

    // Set default cursor
    this.events.onCursorChange('grab');

    const initialViewport = computeInitialViewportState(
      config.canvasWidth,
      config.canvasHeight,
      config.rectWidth,
      config.rectHeight
    );

    this.viewport = initialViewport;
    this.rect = {
      position: new WorldPosition(0, 0),
      width: config.rectWidth,
      height: config.rectHeight,
    };
  }

  getState(): Readonly<ViewportControlsState> {
    return {
      viewport: this.viewport,
      rect: this.rect,
      isDragging: this.isDragging,
    };
  }

  getCursor(): 'grab' | 'grabbing' | 'default' {
    if (this.isDragging) {
      return 'grabbing';
    }
    return 'default';
  }

  handleWheel(event: { metaKey: boolean, deltaX: number, deltaY: number, clientX: number, clientY: number }): void {
    if (event.metaKey) {
      const newScale = this.viewport.scale * (1 - event.deltaY * ZOOM_SENSITIVITY);
      const screenPoint = new ScreenPosition(event.clientX, event.clientY);
      this.viewport = zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
    } else {
      const currentPos = this.viewport.position;
      this.viewport = {
        position: new ViewportPosition(
          currentPos.x - event.deltaX,
          currentPos.y - event.deltaY
        ),
        scale: this.viewport.scale,
      };
    }
  }

  private lastTouchDist: number | null = null;

  handleTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      this.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }

  handleTouchMove(event: TouchEvent): void {
    if (event.touches.length === 2 && this.lastTouchDist !== null) {
      event.preventDefault();
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const scaleFactor = newDist / this.lastTouchDist;
      const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const newScale = this.viewport.scale * scaleFactor;
      const screenPoint = new ScreenPosition(centerX, centerY);
      this.viewport = zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
      this.lastTouchDist = newDist;
    }
  }

  handleTouchEnd(): void {
    this.lastTouchDist = null;
  }

  handleMouseDown(event: MouseEvent): void {
    const screenPos = new ScreenPosition(event.clientX, event.clientY);
    const worldPos = screenToWorld(screenPos, this.viewport);

    if (
      worldPos.x >= this.rect.position.x &&
      worldPos.x <= this.rect.position.x + this.rect.width &&
      worldPos.y >= this.rect.position.y &&
      worldPos.y <= this.rect.position.y + this.rect.height
    ) {
      this.isDragging = true;
      this.dragStartMouse = screenPos;
      this.dragStartRect = new WorldPosition(this.rect.position.x, this.rect.position.y);
      this.events.onCursorChange('grabbing');
    }
  }

  handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStartMouse || !this.dragStartRect) {
      return;
    }

    const currentMouse = new ScreenPosition(event.clientX, event.clientY);
    const worldDelta = screenToWorld(currentMouse, this.viewport).x - screenToWorld(this.dragStartMouse, this.viewport).x;
    const worldDeltaY = screenToWorld(currentMouse, this.viewport).y - screenToWorld(this.dragStartMouse, this.viewport).y;

    this.rect = {
      ...this.rect,
      position: new WorldPosition(
        this.dragStartRect.x + worldDelta,
        this.dragStartRect.y + worldDeltaY
      ),
    };
  }

  handleMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartRect = null;
      this.events.onCursorChange('grab');
    }
  }

  handleMouseLeave(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartRect = null;
      this.events.onCursorChange('default');
    }
  }

  resizeCanvas(newWidth: number, newHeight: number): void {
    this.canvasWidth = newWidth;
    this.canvasHeight = newHeight;
  }
}
