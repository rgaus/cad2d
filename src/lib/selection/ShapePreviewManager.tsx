import { EventEmitter } from 'eventemitter3';
import { Entity, GeometryComponent, type Id } from '../entity';
import { GeometryStore } from '../entity/GeometryStore';
import { FilterComponent } from '../entity/components/FilterComponent';
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

type ShapePreviewManagerEvents = {
  shapePreviewChange: (state: ShapePreviewState) => void;
};

/**
 * Owns the state for the selection inspector's {@link ShapePreview} thumbnail.
 *
 * The manager tracks which (if any) single renderable shape is selected, the attached filters, and
 * the transient highlight / editing-dimension overlays. Every state mutation emits a fresh
 * `shapePreviewChange` event with a new object reference.
 */
export class ShapePreviewManager extends EventEmitter<ShapePreviewManagerEvents> {
  private geometryStore: GeometryStore;
  private selectedIds: Array<Id> = [];
  private sheetDefaultUnit: Sheet['defaultUnit'];

  shapePreview: ShapePreviewState = null;

  constructor(geometryStore: GeometryStore, sheetDefaultUnit: Sheet['defaultUnit']) {
    super();
    this.geometryStore = geometryStore;
    this.sheetDefaultUnit = sheetDefaultUnit;
  }

  /** Recomputes the preview for a new selection, clearing transient highlight/editing state. */
  setSelectedIds(ids: Array<Id>) {
    this.selectedIds = ids;
    this.emitState(this.computeBase());
  }

  /** Updates the sheet default unit used by the preview. */
  setDefaultUnit(unit: Sheet['defaultUnit']) {
    this.sheetDefaultUnit = unit;
    this.updateBase();
  }

  /** Re-fetches the preview geometry/filters when a relevant entity changes. */
  handleGeometryUpdate(entity: Entity) {
    if (this.shapePreview === null) {
      return;
    }
    const isPreviewGeometry = this.shapePreview.geometry.id === entity.id;
    const isFilterForPreview =
      Entity.hasComponent(entity, FilterComponent) &&
      FilterComponent.get(entity).geometryId === this.shapePreview.geometry.id;
    if (!isPreviewGeometry && !isFilterForPreview) {
      return;
    }
    this.updateBase();
  }

  /** Sets the highlight overlay, preserving the rest of the state. */
  setHighlight(highlight: ShapePreviewHighlight | null) {
    if (this.shapePreview === null) {
      return;
    }
    this.emitState({ ...this.shapePreview, highlight });
  }

  /** Sets the editing dimension, preserving the rest of the state. */
  setEditingDimension(dimension: ShapePreviewEditingDimension | null) {
    if (this.shapePreview === null) {
      return;
    }
    this.emitState({ ...this.shapePreview, editingDimension: dimension });
  }

  private isRenderableShape(entity: Entity | null): entity is Entity<GeometryComponent> {
    return entity !== null && Entity.hasComponent(entity, GeometryComponent);
  }

  private computeBase(): ShapePreviewState {
    if (this.selectedIds.length !== 1) {
      return null;
    }
    const entity = this.geometryStore.getById(this.selectedIds[0]);
    if (!this.isRenderableShape(entity)) {
      return null;
    }
    return {
      geometry: entity,
      sheetDefaultUnit: this.sheetDefaultUnit,
      filters: this.geometryStore.findFiltersByGeometryId(entity.id),
      highlight: null,
      editingDimension: null,
    };
  }

  private updateBase() {
    if (this.shapePreview === null) {
      return;
    }
    const base = this.computeBase();
    if (base === null) {
      this.emitState(null);
      return;
    }
    this.emitState({
      ...base,
      highlight: this.shapePreview.highlight,
      editingDimension: this.shapePreview.editingDimension,
    });
  }

  private emitState(state: ShapePreviewState) {
    this.shapePreview = state;
    this.emit('shapePreviewChange', state);
  }
}
