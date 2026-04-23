import EventEmitter from 'eventemitter3';
import {
  ViewportPosition,
  WorldPosition,
  ScreenPosition,
  type ViewportState,
  type Rect,
  type ViewportControlsState,
} from './types';
import { Sheet, CM_TO_PIXELS } from '../sheet/Sheet';

/** Zoom sensitivity for wheel events (deltaY units per zoom unit). */
const ZOOM_SENSITIVITY = 0.005;

/** Configuration for creating a ViewportControls instance. */
export type ViewportControlsConfig = {
  canvasWidth: number;
  canvasHeight: number;
  sheet: Sheet;
};

/** Events emitted by ViewportControls. */
export type ViewportControlsEvents = {
  cursorChange: () => void;
  scaleChange: (scale: number) => void;
};

/**
 * Handles viewport interaction: panning, zooming, and touch gestures.
 * Emits cursorChange events and provides state via getState().
 */
export class ViewportControls extends EventEmitter<ViewportControlsEvents> {
  private viewport: ViewportState;
  private rect: Rect<WorldPosition>;
  private isDragging: boolean = false;
  private dragStartMouse: ScreenPosition | null = null;
  private dragStartViewport: ViewportPosition | null = null;
  private canvasWidth: number;
  private canvasHeight: number;
  private sheet: Sheet;
  private panEnabled: boolean = true;
  private lastScale: number | null = null;

  constructor(config: ViewportControlsConfig) {
    super();

    this.canvasWidth = config.canvasWidth;
    this.canvasHeight = config.canvasHeight;
    this.sheet = config.sheet;

    const sheetWidthInPixels = this.sheet.width.toCentimeters().magnitude * CM_TO_PIXELS;
    const sheetHeightInPixels = this.sheet.height.toCentimeters().magnitude * CM_TO_PIXELS;

    this.viewport = this.computeInitialViewportState(
      config.canvasWidth,
      config.canvasHeight,
      sheetWidthInPixels,
      sheetHeightInPixels
    );

    this.rect = {
      position: new WorldPosition(0, 0),
      width: sheetWidthInPixels,
      height: sheetHeightInPixels,
    };

    this.lastScale = this.viewport.scale;
  }

  /** Returns the current combined state. */
  getState(): Readonly<ViewportControlsState> {
    return {
      viewport: this.viewport,
      rect: this.rect,
      isDragging: this.isDragging,
    };
  }

  /** Returns the current cursor based on drag state. */
  getCursor() {
    if (!this.panEnabled) {
      return null;
    }

    if (this.isDragging) {
      return 'grabbing';
    } else {
      return 'grab';
    }
  }

  /** Handles wheel events for zooming (Cmd+scroll) and panning (scroll). */
  handleWheel(event: { metaKey: boolean, deltaX: number, deltaY: number, clientX: number, clientY: number }): void {
    if (event.metaKey) {
      const newScale = this.viewport.scale * (1 - event.deltaY * ZOOM_SENSITIVITY);
      if (newScale !== this.viewport.scale) {
        const screenPoint = new ScreenPosition(event.clientX, event.clientY);
        this.viewport = this.zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
        if (this.lastScale === null || Math.abs(this.viewport.scale - this.lastScale) > 0.0001) {
          this.lastScale = this.viewport.scale;
          this.emit('scaleChange', this.viewport.scale);
        }
      }
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

  /** Records touch start for pinch-to-zoom detection. */
  handleTouchStart(event: TouchEvent): void {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      this.lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    }
  }

  /** Handles pinch-to-zoom gestures on touch devices. */
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
      if (newScale !== this.viewport.scale) {
        const screenPoint = new ScreenPosition(centerX, centerY);
        this.viewport = this.zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
        if (this.lastScale === null || Math.abs(this.viewport.scale - this.lastScale) > 0.0001) {
          this.lastScale = this.viewport.scale;
          this.emit('scaleChange', this.viewport.scale);
        }
      }
      this.lastTouchDist = newDist;
    }
  }

  /** Clears touch state on touch end. */
  handleTouchEnd(): void {
    this.lastTouchDist = null;
  }

  /** Initiates drag if mouse is within the sheet rectangle and pan is enabled. */
  handleMouseDown(event: MouseEvent): void {
    if (!this.panEnabled) {
      return;
    }

    const screenPos = new ScreenPosition(event.clientX, event.clientY);
    const worldPos = screenPos.toWorld(this.viewport);

    if (
      worldPos.x >= this.rect.position.x &&
      worldPos.x <= this.rect.position.x + this.rect.width &&
      worldPos.y >= this.rect.position.y &&
      worldPos.y <= this.rect.position.y + this.rect.height
    ) {
      this.isDragging = true;
      this.dragStartMouse = screenPos;
      this.dragStartViewport = this.viewport.position;
      this.emit('cursorChange');
    }
  }

  /** Updates rect position during drag. */
  handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStartMouse || !this.dragStartViewport) {
      return;
    }

    const currentMouse = new ScreenPosition(event.clientX, event.clientY);
    const viewportDeltaX = currentMouse.toViewport().x - this.dragStartMouse.toViewport().x;
    const viewportDeltaY = currentMouse.toViewport().y - this.dragStartMouse.toViewport().y;

    this.viewport = {
      position: new ViewportPosition(
        this.dragStartViewport.x + viewportDeltaX,
        this.dragStartViewport.y + viewportDeltaY,
      ),
      scale: this.viewport.scale,
    };
  }

  /** Ends drag and resets cursor. */
  handleMouseUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.dragStartMouse = null;
    this.dragStartViewport = null;
    this.emit('cursorChange');
  }

  /** Ends drag on mouse leave. */
  handleMouseLeave(): void {
    if (this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.dragStartMouse = null;
    this.dragStartViewport = null;
    this.emit('cursorChange');
  }

  /** Updates canvas dimensions for resize handling. */
  resizeCanvas(newWidth: number, newHeight: number): void {
    this.canvasWidth = newWidth;
    this.canvasHeight = newHeight;
  }

  /** Updates the sheet dimensions and resets the rect. */
  updateSheet(sheet: Sheet): void {
    this.sheet = sheet;
    const sheetWidthInPixels = this.sheet.width.toCentimeters().magnitude * CM_TO_PIXELS;
    const sheetHeightInPixels = this.sheet.height.toCentimeters().magnitude * CM_TO_PIXELS;
    this.rect = {
      ...this.rect,
      width: sheetWidthInPixels,
      height: sheetHeightInPixels,
    };
  }

  /** Enables or disables pan-on-drag behavior. */
  setPanEnabled(enabled: boolean): void {
    this.panEnabled = enabled;
    this.emit('cursorChange');
  }

  /** Computes initial viewport state centered on the given rect at scale 1. */
  private computeInitialViewportState(
    canvasWidth: number,
    canvasHeight: number,
    rectWidth: number,
    rectHeight: number,
    initialRectWorldPos: WorldPosition = new WorldPosition(0, 0)
  ): ViewportState {
    const scale = 1;
    const vpX = canvasWidth / 2 - (initialRectWorldPos.x + rectWidth / 2) * scale;
    const vpY = canvasHeight / 2 - (initialRectWorldPos.y + rectHeight / 2) * scale;
    return {
      position: new ViewportPosition(vpX, vpY),
      scale,
    };
  }

  /** Returns a new viewport state zoomed to newScale around the given screen point. */
  private zoomAroundScreenPoint(
    currentState: ViewportState,
    screenPoint: ScreenPosition,
    newScale: number
  ): ViewportState {
    const worldUnderCursor = screenPoint.toWorld(currentState);
    const newVpX = screenPoint.x - worldUnderCursor.x * newScale;
    const newVpY = screenPoint.y - worldUnderCursor.y * newScale;
    return {
      position: new ViewportPosition(newVpX, newVpY),
      scale: newScale,
    };
  }
}
