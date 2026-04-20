import EventEmitter from 'eventemitter3';
import {
  ViewportPosition,
  WorldPosition,
  ScreenPosition,
  type ViewportState,
  type RectState,
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
  cursorChange: (cursor: 'grab' | 'grabbing' | 'default') => void;
};

/**
 * Handles viewport interaction: panning, zooming, and touch gestures.
 * Emits cursorChange events and provides state via getState().
 */
export class ViewportControls extends EventEmitter<ViewportControlsEvents> {
  private viewport: ViewportState;
  private rect: RectState;
  private isDragging: boolean = false;
  private dragStartMouse: ScreenPosition | null = null;
  private dragStartRect: WorldPosition | null = null;
  private canvasWidth: number;
  private canvasHeight: number;
  private sheet: Sheet;

  constructor(config: ViewportControlsConfig) {
    super();

    this.canvasWidth = config.canvasWidth;
    this.canvasHeight = config.canvasHeight;
    this.sheet = config.sheet;

    this.emit('cursorChange', 'default');

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
  getCursor(): 'grab' | 'grabbing' | 'default' {
    if (this.isDragging) {
      return 'grabbing';
    }
    return 'default';
  }

  /** Handles wheel events for zooming (Cmd+scroll) and panning (scroll). */
  handleWheel(event: { metaKey: boolean, deltaX: number, deltaY: number, clientX: number, clientY: number }): void {
    if (event.metaKey) {
      const newScale = this.viewport.scale * (1 - event.deltaY * ZOOM_SENSITIVITY);
      const screenPoint = new ScreenPosition(event.clientX, event.clientY);
      this.viewport = this.zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
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
      const screenPoint = new ScreenPosition(centerX, centerY);
      this.viewport = this.zoomAroundScreenPoint(this.viewport, screenPoint, newScale);
      this.lastTouchDist = newDist;
    }
  }

  /** Clears touch state on touch end. */
  handleTouchEnd(): void {
    this.lastTouchDist = null;
  }

  /** Initiates drag if mouse is within the sheet rectangle. */
  handleMouseDown(event: MouseEvent): void {
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
      this.dragStartRect = new WorldPosition(this.rect.position.x, this.rect.position.y);
      this.emit('cursorChange', 'grabbing');
    }
  }

  /** Updates rect position during drag. */
  handleMouseMove(event: MouseEvent): void {
    if (!this.isDragging || !this.dragStartMouse || !this.dragStartRect) {
      return;
    }

    const currentMouse = new ScreenPosition(event.clientX, event.clientY);
    const worldDelta = currentMouse.toWorld(this.viewport).x - this.dragStartMouse.toWorld(this.viewport).x;
    const worldDeltaY = currentMouse.toWorld(this.viewport).y - this.dragStartMouse.toWorld(this.viewport).y;

    this.rect = {
      ...this.rect,
      position: new WorldPosition(
        this.dragStartRect.x + worldDelta,
        this.dragStartRect.y + worldDeltaY
      ),
    };
  }

  /** Ends drag and resets cursor. */
  handleMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartRect = null;
      this.emit('cursorChange', 'default');
    }
  }

  /** Ends drag on mouse leave. */
  handleMouseLeave(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.dragStartMouse = null;
      this.dragStartRect = null;
      this.emit('cursorChange', 'default');
    }
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
      position: new WorldPosition(0, 0),
      width: sheetWidthInPixels,
      height: sheetHeightInPixels,
    };
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