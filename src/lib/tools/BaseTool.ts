import EventEmitter from 'eventemitter3';
import type { Id } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import {
  type SnappingLineSeriesOptions,
  type SnappingOptions,
  applySnapping as applySnappingFn,
  applySnappingLineSeries as applySnappingLineSeriesFn,
} from '@/lib/snapping';
import { HistoryManager } from '../history/HistoryManager';
import { KeyCombo } from '../index-mapper';
import { SerializationManager } from '../serialization/SerializationManager';
import { Sheet } from '../sheet/Sheet';
import { ScreenPosition, SheetPosition, type ViewportState } from '../viewport/types';
import { SelectionManager } from './SelectionManager';
import { ToolManager } from './ToolManager';
import { type ResizeCorner, type ResizeEdge, type ToolType } from './types';

type BaseToolEvents = {
  cursorChanged: (cursor: string) => void;
  tooltipVisibilityChanged: (tooltip: string | null) => void;
};

/** The base class of a tool which a user can use to interact with the sheet. */
export abstract class BaseTool<
  Events extends EventEmitter.ValidEventTypes = {},
> extends EventEmitter<Events & BaseToolEvents> {
  protected toolManager: ToolManager;

  constructor(toolManager: ToolManager) {
    super();
    this.toolManager = toolManager;
  }

  /** Returns a string used to represent the given tool. */
  abstract readonly type: ToolType;

  /** Key combo used to activate the tool. Can be multiple keys in a row. */
  readonly focusKeyCombo: KeyCombo | null = null;

  #cursor: string | null = null;

  /** Default cursor string for this tool. Subclasses override to change. */
  protected defaultCursor: string = 'default';

  /** Returns the current cursor string for this tool. */
  get cursor(): string {
    if (this.#cursor === null) {
      this.#cursor = this.defaultCursor;
    }
    return this.#cursor;
  }

  /** Sets the cursor for this tool and emits a cursorChanged event. */
  set cursor(value: string) {
    if (this.#cursor !== value) {
      this.#cursor = value;
      (this as EventEmitter).emit('cursorChanged', value);
    }
  }

  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTooltipType: string | null = null;

  /** Schedules a tooltip to appear after `timeoutMs`. If a different tooltip type is already
   * pending, the old one is cancelled first. If the same type is already pending, this is a no-op. */
  protected scheduleTooltip(type: string, timeoutMs: number): void {
    if (this.pendingTooltipType !== null) {
      if (this.pendingTooltipType === type) {
        return;
      }
      this.cancelTooltip();
    }
    this.pendingTooltipType = type;
    this.tooltipTimer = setTimeout(() => {
      this.showTooltip(type);
    }, timeoutMs);
  }

  protected showTooltip(type: string | null): void {
    (this as EventEmitter).emit('tooltipVisibilityChanged', type);
  }

  /** Cancels any pending tooltip timer and emits `null`. Safe to call when no timer is active. */
  protected cancelTooltip(): void {
    if (this.tooltipTimer !== null) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
    this.pendingTooltipType = null;
    this.showTooltip(null);
  }

  /** Restarts the tooltip timer if the given `type` is currently pending. Used to reset the
   * timeout on mouse movement (e.g. for the geometry-fill tooltip). */
  protected restartTooltip(type: string, timeoutMs: number): void {
    if (this.pendingTooltipType !== type) {
      return;
    }
    const timerWasSet = this.tooltipTimer !== null;
    this.cancelTooltip();
    if (timerWasSet) {
      this.scheduleTooltip(type, timeoutMs);
    }
  }

  /** Called when a tool is selected by the user. */
  handleToolFocus(): void {}

  /** Called when a tool is de-selected by the user. */
  handleToolBlur(): void {}

  // Generic pointer events (viewport-level)
  handlePointerDown(_screenPos: ScreenPosition, _viewport: ViewportState): boolean {
    return false;
  }
  handlePointerMove(_screenPos: ScreenPosition, _viewport: ViewportState): boolean {
    return false;
  }
  handlePointerUp(_screenPos: ScreenPosition, _viewport: ViewportState): boolean {
    return false;
  }
  handleDblClick(_screenPos: ScreenPosition, _viewport: ViewportState): boolean {
    return false;
  }
  handleWheel(_event: WheelEvent): boolean {
    return false;
  }

  // Generic keyboard
  handleKeyDown(_event: KeyboardEvent): boolean {
    return false;
  }
  handleKeyUp(_event: KeyboardEvent): boolean {
    return false;
  }

  // Shape-specific pointer events (forwarded by renderer via hit testing)
  handlePolygonFillPointerDown(_event: PointerEvent, _polygonId: Id): boolean {
    return false;
  }
  handleRectangleFillPointerDown(_event: PointerEvent, _rectangleId: Id): boolean {
    return false;
  }
  handleEllipseFillPointerDown(_event: PointerEvent, _ellipseId: Id): boolean {
    return false;
  }

  handlePolygonVertexPointerDown(
    _event: PointerEvent,
    _polygonId: Id,
    _segmentIndex: number,
  ): boolean {
    return false;
  }
  handlePolygonControlPointerDown(
    _event: PointerEvent,
    _polygonId: Id,
    _segmentIndex: number,
    _pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
  ): boolean {
    return false;
  }

  handlePolygonEdgeEnter(_polygonId: Id, _segmentIndex: number): boolean {
    return false;
  }
  handlePolygonEdgeLeave(_polygonId: Id, _segmentIndex: number): boolean {
    return false;
  }
  handleGeometryFillEnter(_geometryId: Id): boolean {
    return false;
  }
  handleGeometryFillLeave(_geometryId: Id): boolean {
    return false;
  }

  handleBoundingBoxCornerPointerDown(
    _event: PointerEvent,
    _geometryId: Id,
    _corner: ResizeCorner,
  ): boolean {
    return false;
  }
  handleBoundingBoxEdgePointerDown(
    _event: PointerEvent,
    _geometryId: Id,
    _edge: ResizeEdge,
  ): boolean {
    return false;
  }

  handleConstraintEndpointPointerDown(
    _event: PointerEvent,
    _constraintId: Id,
    _pointKey: 'pointA' | 'pointB',
  ): boolean {
    return false;
  }

  /** Returns the GeometryStore. */
  getGeometryStore(): GeometryStore {
    return this.toolManager.getGeometryStore();
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.toolManager.getSelectionManager();
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.toolManager.getHistoryManager();
  }

  /** Returns the SerializationManager, or null if not set. */
  getSerializationManager(): SerializationManager | null {
    return this.toolManager.getSerializationManager();
  }

  /** Returns the Sheet from the SerializationManager, or null if not set. */
  getSheet(): Sheet | null {
    return this.getSerializationManager()?.sheet ?? null;
  }
}
