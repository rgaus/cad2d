import type { ActionsManager } from '@/lib/actions/ActionsManager';
import type { Entity, Id } from '@/lib/entity';
import type { GeometryStore } from '@/lib/entity/GeometryStore';
import type { HistoryManager } from '@/lib/history/HistoryManager';
import type { Length, UnitType } from '@/lib/units/length';
import type { ShapePreviewEditingDimension, ShapePreviewManager } from './ShapePreviewManager';
import type { FieldHandlers, OpenAtIndexState, WorkingValue } from './fields';

/**
 * The minimal structural shape required by {@link SelectionInspectorContext.makeLengthHandlers} to
 * re-apply an edit through a specific component. Every component namespace with an `update`
 * function satisfies this.
 */
export type FieldComponent = {
  key: PropertyKey;
  update(entity: any, partial: any): any;
};

/**
 * The imperative surface a component's `computeSelectionInspectorFields` needs from the
 * {@link SelectionInspectorManager}: access to shared state plus the drag / edit-session helpers
 * that live on the manager. The manager implements this and passes itself to each component's
 * field builder, keeping the field-building code decoupled from the manager class.
 */
export interface SelectionInspectorContext {
  /** The sheet's current default unit, used to build {@link Length} values. */
  readonly sheetDefaultUnit: UnitType;

  /** Live geometry store, used to re-read current state inside handler closures. */
  readonly geometryStore: GeometryStore;

  /** History manager, used for committed edits and undo entries. */
  readonly historyManager: HistoryManager;

  /** Actions manager (may be unset until the app wires it up). */
  readonly actionsManager: ActionsManager | null;

  /** Shape preview manager, used for editing-dimension / highlight overlays. */
  readonly shapePreview: ShapePreviewManager;

  /** Captures the current on-disk state of `id` so it can be restored on cancel. */
  captureDragOriginal(id: Id): void;

  /** Restores `id` to its captured original and drops the captured marker. */
  restoreDragOriginal(id: Id): void;

  /** Whether an edit is currently in progress for `id`. */
  hasDragOriginal(id: Id): boolean;

  /** Returns the captured original state for `id`, or undefined if no edit is in progress. */
  getDragOriginal(id: Id): Entity | undefined;

  /** Drops the captured original marker for `id` without restoring it. */
  clearDragOriginal(id: Id): void;

  /** Cleans up after a field commit (drops the marker and recomputes fields). */
  finishEdit(id: Id): void;

  /** Stores an in-progress field value and emits `workingFieldDataChange`. */
  setWorkingFieldData(key: string, value: WorkingValue): void;

  /** Reads a stored in-progress field value. */
  getWorkingFieldData(key: string): WorkingValue | undefined;

  /** Clears all in-progress field values and emits `workingFieldDataChange`. */
  clearWorkingFieldData(): void;

  /**
   * Produces standard drag-aware handlers for a length field.
   *
   * `onChange` captures the original, applies the change immediately via `*Direct` (no history).
   * `onBlur` restores the original, re-applies via the regular API (with history), then cleans up.
   * `onKeyDown('Escape')` restores the original and recomputes fields.
   */
  makeLengthHandlers(
    id: Id,
    key: string,
    component: FieldComponent,
    computeUpdate: (value: Length) => unknown,
    editingDimension?: ShapePreviewEditingDimension,
  ): FieldHandlers<Length>;

  /**
   * Produces standard drag-aware handlers for a single polygon point X/Y coordinate.
   *
   * `onChange` captures the original, applies the point move immediately via `*Direct` (no
   * history), and stores the pending value keyed by point index and axis. `onBlur` restores the
   * original, re-applies via the regular API (with history), then cleans up.
   */
  makePolygonPointLengthHandlers(
    id: Id,
    axis: 'x' | 'y',
  ): { onChange: (index: number, value: Length) => void; onBlur: (index: number) => void };

  /** Emits a new {@link OpenAtIndexState}. */
  setOpenAtIndexState(state: OpenAtIndexState): void;

  /** Registers the window-level cleanup for an in-progress openAtIndex drag. */
  setOpenAtIndexDragCleanup(cleanup: (() => void) | null): void;

  /** Clears the registered openAtIndex drag cleanup if it is still the current one. */
  clearOpenAtIndexDragCleanup(cleanup: (() => void) | null): void;

  /** Rebuilds and emits the selection inspector fields. */
  recomputeFields(): void;

  /**
   * Begins an interactive entity pick session on the select tool. While active, hovering a
   * geometry highlights it and clicking one invokes `onSelect` with its id. `fieldKey` is the key
   * of the entity-selector field initiating the pick, used to scope the "Cancel" affordance.
   */
  beginEntityPick(fieldKey: string, onSelect: (id: Entity['id']) => void): void;

  endEntityPick(): void;
}
