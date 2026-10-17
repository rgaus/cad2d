import { EventEmitter } from 'eventemitter3';
import { ActionsManager } from '../actions/ActionsManager';
import {
  ConstraintComponent,
  type ConstraintEndpoint,
  DatumComponent,
  Entity,
  FillColorComponent,
  FrameComponent,
  GeometryComponent,
  type Id,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '../entity';
import { GeometryStore } from '../entity/GeometryStore';
import { FilterComponent } from '../entity/components/FilterComponent';
import { PolygonData } from '../entity/geometry/polygon';
import { HistoryManager } from '../history/HistoryManager';
import { Sheet } from '../sheet/Sheet';
import { type SelectTool } from '../tools/SelectTool';
import { SelectionManager } from '../tools/SelectionManager';
import type { ToolManager } from '../tools/ToolManager';
import { Angle } from '../units/angle';
import { Length } from '../units/length';
import { SheetPosition } from '../viewport/types';
import {
  type ShapePreviewEditingDimension,
  ShapePreviewManager,
  type ShapePreviewState,
} from './ShapePreviewManager';
import {
  type EntitySelectorHandlers,
  type Field,
  type FieldHandlers,
  type FieldLabel,
  type FieldLeaf,
  type FieldOptions,
  type FieldOptionsLabel,
  type FieldOptionsList,
  type FieldOptionsRow,
  type OpenAtIndexState,
  type OptionsToSingle,
  type PolygonPointsHandlers,
  type Row,
  type Variance,
  type WorkingFieldData,
} from './fields';
import type { SelectionInspectorContext } from './selection-inspector-context';
import { AnchorPointComponent } from '../entity/components/AnchorPointComponent';

export type {
  Field,
  FieldLabel,
  FieldLeaf,
  FieldRow,
  OpenAtIndexState,
  WorkingFieldData,
} from './fields';

/** The order of components in the {@link SelectionInspectorManager}. If a component isn't in this
 * list, it will be rendered at the bottom. */
function getComponentKeyOrdering(key: string): number {
  return [
    GeometryComponent.key,
    ConstraintComponent.key,
    DatumComponent.key,
    FilterComponent.key,
    FrameComponent.key,
    LinkDimensionsComponent.key,

    // Fill color + render order at the bottom
    FillColorComponent.key,
    RenderOrderComponent.key,
    AnchorPointComponent.key,
  ].indexOf(key as any);
}

function getComponentByKey(key: string) {
  for (const component of [
    GeometryComponent,
    FillColorComponent,
    ConstraintComponent,
    DatumComponent,
    FilterComponent,
    FrameComponent,
    LinkDimensionsComponent,
    RenderOrderComponent,
    AnchorPointComponent,
  ]) {
    if (component.key === key) {
      return component;
    }
  }
  return null;
}

type SelectionInspectorManagerEvents = {
  fieldsChange: (fields: Array<Field>) => void;
  workingFieldDataChange: (fieldData: WorkingFieldData) => void;
  openAtIndexStateChange: (dragging: OpenAtIndexState) => void;
  shapePreviewChange: (state: ShapePreviewState) => void;
};

export class SelectionInspectorManager extends EventEmitter<SelectionInspectorManagerEvents> {
  private sheet: Sheet;
  private selectionManager: SelectionManager;
  private geometryStore: GeometryStore;
  private historyManager: HistoryManager;
  private actionsManager: ActionsManager | null = null;
  private toolManager: ToolManager | null = null;

  private shapePreviewManager: ShapePreviewManager;

  private dragOriginals: Map<Id, Entity> = new Map();

  private openAtIndexDragCleanup: (() => void) | null = null;

  private sheetDefaultUnit: Sheet['defaultUnit'];

  constructor(
    sheet: Sheet,
    selectionManager: SelectionManager,
    geometryStore: GeometryStore,
    historyManager: HistoryManager,
  ) {
    super();
    this.sheet = sheet;
    this.selectionManager = selectionManager;
    this.geometryStore = geometryStore;
    this.historyManager = historyManager;

    this.sheetDefaultUnit = sheet.defaultUnit;

    this.shapePreviewManager = new ShapePreviewManager(geometryStore, sheet.defaultUnit);
    this.shapePreviewManager.on('shapePreviewChange', this.handleShapePreviewChange);

    this.selectionManager.on('selectionChange', this.handleSelectionChange);
    this.sheet.on('defaultUnitChange', this.handleDefaultUnitChange);
    this.geometryStore.on('geometryUpdated', this.handleGeometryUpdate);
  }

  destructor() {
    this.openAtIndexDragCleanup?.();
    this.openAtIndexDragCleanup = null;
    this.shapePreviewManager.off('shapePreviewChange', this.handleShapePreviewChange);
    this.geometryStore.off('geometryUpdated', this.handleGeometryUpdate);
    this.sheet.off('defaultUnitChange', this.handleDefaultUnitChange);
    this.selectionManager.off('selectionChange', this.handleSelectionChange);
    this.selectTool?.off('entityPickBegin', this.handleEntityPickBegin);
    this.selectTool?.off('entityPickEnd', this.handleEntityPickEnd);
    this.selectTool = null;
    this.actionsManager = null;
    this.geometryStore = null as any;
    this.selectionManager = null as any;
    this.toolManager = null;
  }

  setActionsManager(actionsManager: ActionsManager) {
    this.actionsManager = actionsManager;
  }

  /** The select tool, re-read from the ToolManager so we can subscribe to its pick events. */
  private selectTool: SelectTool | null = null;

  /** Whether an interactive entity pick session is currently active. */
  private entityPickActive: boolean = false;

  /** The field key which initiated the current pick session, or null when not picking. */
  private entityPickFieldKey: string | null = null;

  /** Sets the ToolManager, enabling selection-inspector fields to drive interactive picks. */
  setToolManager(toolManager: ToolManager) {
    this.toolManager = toolManager;

    // Subscribe to the select tool's pick session events so the inspector can reflect its state.
    this.selectTool?.off('entityPickBegin', this.handleEntityPickBegin);
    this.selectTool?.off('entityPickEnd', this.handleEntityPickEnd);
    this.selectTool = toolManager.getTool('select');
    this.selectTool.on('entityPickBegin', this.handleEntityPickBegin);
    this.selectTool.on('entityPickEnd', this.handleEntityPickEnd);
  }

  private handleEntityPickBegin = () => {
    this.entityPickActive = true;
    this.recomputeFields();
  };

  private handleEntityPickEnd = () => {
    this.entityPickActive = false;
    this.entityPickFieldKey = null;
    this.recomputeFields();
  };

  private captureDragOriginal(entityId: Id): void {
    if (this.dragOriginals.has(entityId)) {
      return;
    }
    const entity = this.geometryStore.getById(entityId);
    if (entity) {
      this.dragOriginals.set(entityId, entity);
    }
  }

  private restoreDragOriginal(entityId: Id): void {
    const original = this.dragOriginals.get(entityId);
    if (!original) {
      return;
    }
    this.geometryStore.updateByIdDirect(entityId, original);
    this.dragOriginals.delete(entityId);
  }

  /** Drops every in-progress edit, restoring each entity to its captured original without recording
   * any history. Used when the selection changes mid-edit. */
  private discardActiveEdits(): void {
    for (const entityId of [...this.dragOriginals.keys()]) {
      this.restoreDragOriginal(entityId);
    }
    this.workingFieldData.clear();
    this.emit('workingFieldDataChange', new Map());
  }

  /** Cleans up after a field commit, dropping the drag-original marker and refreshing the field
   * tree with the committed values. */
  private finishEdit(entityId: Id): void {
    this.dragOriginals.delete(entityId);
    this.recomputeFields();
  }

  /** Builds the {@link SelectionInspectorContext} facade handed to component field builders. */
  private makeContext(): SelectionInspectorContext {
    return {
      sheetDefaultUnit: this.sheetDefaultUnit,
      geometryStore: this.geometryStore,
      historyManager: this.historyManager,
      actionsManager: this.actionsManager,
      shapePreview: this.shapePreviewManager,

      captureDragOriginal: (id) => this.captureDragOriginal(id),
      restoreDragOriginal: (id) => this.restoreDragOriginal(id),
      hasDragOriginal: (id) => this.dragOriginals.has(id),
      getDragOriginal: (id) => this.dragOriginals.get(id),
      clearDragOriginal: (id) => {
        this.dragOriginals.delete(id);
      },
      finishEdit: (id) => this.finishEdit(id),
      setWorkingFieldData: (key, value) => {
        this.workingFieldData.set(key, value);
        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
      },
      getWorkingFieldData: (key) => this.workingFieldData.get(key),
      clearWorkingFieldData: () => {
        this.workingFieldData.clear();
        this.emit('workingFieldDataChange', new Map());
      },
      makeLengthHandlers: (id, key, component, computeUpdate, editingDimension) =>
        this.makeLengthHandlers(id, key, component, computeUpdate, editingDimension),
      makePolygonPointLengthHandlers: (id, axis) => this.makePolygonPointLengthHandlers(id, axis),
      setOpenAtIndexState: (state) => this.emit('openAtIndexStateChange', state),
      setOpenAtIndexDragCleanup: (cleanup) => {
        this.openAtIndexDragCleanup = cleanup;
      },
      clearOpenAtIndexDragCleanup: (cleanup) => {
        if (this.openAtIndexDragCleanup === cleanup) {
          this.openAtIndexDragCleanup = null;
        }
      },
      recomputeFields: () => this.recomputeFields(),
      beginEntityPick: (fieldKey, onSelect) => {
        if (!this.toolManager) {
          return;
        }
        this.entityPickFieldKey = fieldKey;
        this.toolManager.setActiveTool('select');
        this.toolManager.getTool('select').beginEntityPick(onSelect);
      },
      endEntityPick: () => {
        if (!this.toolManager) {
          return;
        }
        this.toolManager.setActiveTool('select');
        this.toolManager.getTool('select').endEntityPick();
      },
    };
  }

  /**
   * Produces standard drag-aware handlers for a length-type field.
   *
   * onChange captures the original entity, applies the change immediately via *Direct (no history).
   * onBlur restores the original, re-applies via the regular API (with history), then cleans up.
   * onKeyDown('Escape') restores the original and recomputes fields.
   *
   * @param computeUpdate — re-reads current state from the store and returns the update partial.
   *   Must be side-effect-free (called twice: once for *Direct, once on blur restore+re-apply).
   */
  private makeLengthHandlers(
    id: Id,
    key: string,
    component: any,
    computeUpdate: (value: Length) => any,
    editingDimension?: ShapePreviewEditingDimension,
  ): FieldHandlers<Length> {
    return {
      onChange: (value) => {
        this.captureDragOriginal(id);
        this.workingFieldData.set(key, { type: 'length', value });
        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
        const update = computeUpdate(value);
        if (update) {
          this.geometryStore.updateByIdWithComponentDirect(id, component, (old: Entity) =>
            component.update(old, update),
          );
        }
      },
      onFocus: () => {
        if (editingDimension) {
          this.shapePreviewManager.setEditingDimension(editingDimension);
        }
      },
      onBlur: () => {
        if (editingDimension) {
          this.shapePreviewManager.setEditingDimension(null);
        }
        if (!this.dragOriginals.has(id)) {
          return;
        }
        const fieldData = this.workingFieldData.get(key);
        if (!fieldData || fieldData.type !== 'length') {
          return;
        }
        this.geometryStore.updateByIdDirect(id, this.dragOriginals.get(id)!);
        const update = computeUpdate(fieldData.value);
        if (update) {
          this.geometryStore.updateByIdWithComponent(id, component, (old: Entity) =>
            component.update(old, update),
          );
        }
        this.dragOriginals.delete(id);
        this.recomputeFields();
      },
      onKeyDown: (k) => {
        if (k === 'Escape' && this.dragOriginals.has(id)) {
          this.restoreDragOriginal(id);
          this.workingFieldData.clear();
          this.emit('workingFieldDataChange', new Map());
          this.recomputeFields();
        }
      },
    };
  }

  /**
   * Produces standard drag-aware handlers for a single polygon point X or Y coordinate.
   *
   * onChange captures the original entity, applies the point move immediately via *Direct (no
   * history), and stores the pending value keyed by the point index and axis. onBlur restores the
   * original, re-applies via the regular API (with history), then cleans up.
   *
   * @param id - The polygon entity id being edited.
   * @param axis - Which coordinate ('x' or 'y') these handlers mutate.
   */
  private makePolygonPointLengthHandlers(
    id: Id,
    axis: 'x' | 'y',
  ): { onChange: (index: number, value: Length) => void; onBlur: (index: number) => void } {
    const workingKey = (index: number) => `point-${index}-${axis}`;

    const computeUpdate = (index: number, value: Length): Partial<PolygonData> | null => {
      const current = this.geometryStore.getByIdWithComponent(id, GeometryComponent);
      if (!current || !GeometryComponent.isPolygon(current)) {
        return null;
      }
      const prevData = GeometryComponent.get(current);
      const magnitude = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
      const segments = prevData.points.map((s, i) => {
        if (axis === 'x') {
          // First point of closed polygons updates the first and last points
          if (prevData.closed && index === 0 && (i === 0 || i === prevData.points.length - 1)) {
            return { ...s, point: new SheetPosition(magnitude, s.point.y) };
          }
          if (i === index) {
            return { ...s, point: new SheetPosition(magnitude, s.point.y) };
          }
          return s;
        }
        if (i !== index) {
          return s;
        }
        return { ...s, point: new SheetPosition(s.point.x, magnitude) };
      });
      return { points: segments };
    };

    return {
      onChange: (index, value) => {
        this.captureDragOriginal(id);
        this.workingFieldData.set(workingKey(index), { type: 'length', value });
        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
        const update = computeUpdate(index, value);
        if (update) {
          this.geometryStore.updateByIdWithComponentDirect(id, GeometryComponent, (old) =>
            GeometryComponent.update(old, update),
          );
        }
      },
      onBlur: (index) => {
        if (!this.dragOriginals.has(id)) {
          return;
        }
        const fieldData = this.workingFieldData.get(workingKey(index));
        if (!fieldData || fieldData.type !== 'length') {
          return;
        }
        this.geometryStore.updateByIdDirect(id, this.dragOriginals.get(id)!);
        const update = computeUpdate(index, fieldData.value);
        if (update) {
          this.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) =>
            GeometryComponent.update(old, update),
          );
        }
        this.dragOriginals.delete(id);
        this.recomputeFields();
      },
    };
  }

  private selectedIds: Array<Entity['id']> = [];

  handleSelectionChange = (ids: Array<Entity['id']>) => {
    if (
      this.selectedIds.length === ids.length &&
      this.selectedIds.every((selectedId) => ids.includes(selectedId))
    ) {
      // No change, so bail early
      return;
    }
    this.discardActiveEdits();
    this.selectedIds = ids;
    this.recomputeFields();
    this.shapePreviewManager.setSelectedIds(ids);
  };

  handleDefaultUnitChange = (defaultUnit: Sheet['defaultUnit']) => {
    this.sheetDefaultUnit = defaultUnit;
    this.recomputeFields();
    this.shapePreviewManager.setDefaultUnit(defaultUnit);
  };

  handleGeometryUpdate = (entity: Entity) => {
    if (this.selectedIds.includes(entity.id) && !this.dragOriginals.has(entity.id)) {
      this.recomputeFields();
    }
    this.shapePreviewManager.handleGeometryUpdate(entity);
  };

  private workingFieldData: WorkingFieldData = new Map();

  fields: Array<Field> = [];

  shapePreview: ShapePreviewState = null;

  private handleShapePreviewChange = (state: ShapePreviewState) => {
    this.shapePreview = state;
    this.emit('shapePreviewChange', state);
  };

  recomputeFields() {
    const fields = new Map<string, FieldOptionsList>();
    const fieldFrequencies = new Map<string, number>();
    const fieldKeyOrder: Array<string> = [];

    // Step 1: Generate list of fields
    for (const entity of this.geometryStore.getByIds(this.selectedIds)) {
      const componentKeys = Object.keys(entity.components).sort((a, b) => {
        return getComponentKeyOrdering(a) - getComponentKeyOrdering(b);
      });
      for (const key of componentKeys) {
        const Component = getComponentByKey(key);
        if (!Component) {
          continue;
        }
        const computed = this.computeFieldsForComponent(entity, Component);
        for (const field of computed) {
          const existingForKey = fields.get(field.key) ?? [];

          // Base case: add first entry if there's nothing stored under that key yet.
          if (existingForKey.length === 0) {
            fieldKeyOrder.push(field.key);
            fieldFrequencies.set(field.key, (fieldFrequencies.get(field.key) ?? 0) + 1);
            fields.set(field.key, [field]);
            continue;
          }

          // Rows should be pushed twice
          if (field.type === 'row' || field.type === 'polygon-points') {
            existingForKey.push(field);
            fieldFrequencies.set(field.key, (fieldFrequencies.get(field.key) ?? 0) + 1);
            fields.set(field.key, existingForKey);
            continue;
          }

          // Entries without `value` cannot be merged together, so just use the first one and drop
          // all others.
          //
          // Example: "link" button, heterogeneous structured rows with identical keys, etc
          if (!('value' in field)) {
            if (field.type !== existingForKey[0].type) {
              console.warn(
                `Field key=${field.key} type=${field.type} cannot be merged with existing key of type=${existingForKey[0].type}, skipping...`,
              );
              continue;
            }
            fieldFrequencies.set(field.key, (fieldFrequencies.get(field.key) ?? 0) + 1);
            continue;
          }

          // Otherwise, merge fields together
          const match = existingForKey.find(
            (existing) => existing.type === field.type && existing.key === field.key,
          );
          if (match) {
            if (!('value' in match)) {
              console.warn(
                `Field key=${field.key} type=${field.type} cannot be merged into existing matching field type=${match.type}, no "value" attribute found, skipping...`,
              );
              continue;
            }
            fieldFrequencies.set(field.key, (fieldFrequencies.get(field.key) ?? 0) + 1);
            match.value = [...match.value, ...(field.value as any)];
            match.handlers = [...match.handlers, ...(field.handlers as any)];
          }
        }
      }
    }

    // Step 2: Determine which fields all contain a single homogeneous value, or many heterogeneous
    // TODO

    const processed = fieldKeyOrder.flatMap((key) => {
      if (fieldFrequencies.get(key) !== this.selectedIds.length) {
        return [];
      }
      return [this.aggregateFieldValue(fields.get(key)!, key)];
    });

    // Erase any fields whicha re currently being filled out
    this.workingFieldData.clear();

    this.fields = processed;
    this.emit('fieldsChange', processed);
  }

  private aggregateRows(rows: Array<FieldOptionsRow>): Row<Variance<FieldLeaf | FieldLabel>> {
    if (rows.length === 0) {
      return { type: 'row' as const, key: 'no op', fields: [] };
    }
    if (rows.some((r) => r.key !== rows[0].key)) {
      // Rows have different keys, so return `heterogeneous` entries for all fields of the first row
      // item
      return {
        type: 'row' as const,
        key: rows[0].key,
        fields: rows[0].fields.map((f) => ({
          type: 'heterogeneous',
          key: f.key,
          fieldType: f.type,
        })),
      };
    }

    const fieldCommonKeys = Array.from(
      rows.map((row) => new Set(row.fields.map((f) => f.key))).reduce((a, b) => a.intersection(b)),
    );
    return {
      type: 'row',
      key: rows[0].key,
      fields: fieldCommonKeys.map((key) => {
        const fieldsForKeyAcrossRows = [];
        for (const row of rows) {
          const match = row.fields.find((f) => f.key === key);
          if (match) {
            fieldsForKeyAcrossRows.push(match);
          } else {
            return { type: 'heterogeneous', key, fieldType: row.fields[0]?.type };
          }
        }
        return this.aggregateFieldValue(fieldsForKeyAcrossRows, key) as Variance<
          FieldLeaf | FieldLabel
        >;
      }),
    };
  }

  private aggregateLabels(entries: Array<FieldOptionsLabel>): FieldLabel {
    if (entries.length === 0) {
      return { type: 'label' as const, key: 'no op', label: '', fields: [] };
    }
    if (entries.some((r) => r.key !== entries[0].key)) {
      // Labels have different keys, so return `heterogeneous` entries for all fields of the first row
      // item
      return {
        type: 'label' as const,
        key: entries[0].key,
        label: entries[0].label,
        fields: entries[0].fields.map((f) => ({
          type: 'heterogeneous',
          key: f.key,
          fieldType: f.type,
        })),
      };
    }

    const fieldCommonKeys = Array.from(
      entries
        .map((row) => new Set(row.fields.map((f) => f.key)))
        .reduce((a, b) => a.intersection(b)),
    );
    return {
      type: 'label',
      key: entries[0].key,
      label: entries[0].label,
      fields: fieldCommonKeys.map((key) => {
        const fieldsForKeyAcrossLabels = [];
        for (const label of entries) {
          const match = label.fields.find((f) => f.key === key);
          if (match) {
            fieldsForKeyAcrossLabels.push(match);
          } else {
            return { type: 'heterogeneous', key, fieldType: label.fields[0]?.type };
          }
        }
        return this.aggregateFieldValue(fieldsForKeyAcrossLabels, key) as Variance<FieldLeaf>;
      }),
    };
  }

  /** Takes an "options" type, and collapses it into a single value version. Uses either the first
   * entry in the options type as the new value, or if specified, {@link newValue}. */
  private collapseFieldOptions<F extends FieldOptions | FieldOptionsRow | FieldOptionsLabel>(
    fieldOptions: Array<F>,
    newValue?: Extract<F, { value: unknown }>['value'][0],
  ): FieldLeaf {
    const fieldOptionsFirst = fieldOptions[0];

    const handlers = fieldOptions
      .map((fo) => {
        switch (fo.type) {
          case 'label':
          case 'row':
            throw new Error(
              'Field Option type=label cannot be processed by SelectionInspectorManager.collapseFieldOptions',
            );
          default:
            return fo.handlers;
        }
      })
      .flat();

    const combineHandlers = <T extends unknown>(
      handlers: Array<FieldHandlers<T>>,
    ): FieldHandlers<T> => {
      const result: Record<string, (...args: Array<any>) => void> = {};

      if (handlers.some((h) => h.onChange)) {
        result.onChange = (t: T) => {
          this.historyManager.applyTransaction(
            'selection-inspector-change',
            () => {
              for (const handler of handlers) {
                handler.onChange?.(t);
              }
            },
            { collapseIfSingle: true, omitIfEmpty: true },
          );
        };
      }

      if (handlers.some((h) => h.onBlur)) {
        result.onBlur = () => {
          this.historyManager.applyTransaction(
            'selection-inspector-blur',
            () => {
              for (const handler of handlers) {
                handler.onBlur?.();
              }
            },
            { collapseIfSingle: true, omitIfEmpty: true },
          );
        };
      }

      if (handlers.some((h) => h.onClick)) {
        result.onClick = () => {
          this.historyManager.applyTransaction(
            'selection-inspector-click',
            () => {
              for (const handler of handlers) {
                handler.onClick?.();
              }
            },
            { collapseIfSingle: true, omitIfEmpty: true },
          );
        };
      }

      if (handlers.some((h) => h.onFocus)) {
        result.onFocus = () => {
          for (const handler of handlers) {
            handler.onFocus?.();
          }
        };
      }

      if (handlers.some((h) => h.onKeyDown)) {
        result.onKeyDown = (key: string) => {
          for (const handler of handlers) {
            handler.onKeyDown?.(key);
          }
        };
      }

      if ((handlers as Array<Partial<EntitySelectorHandlers>>).some((h) => h.onSelect)) {
        result.onSelect = (id: Entity['id']) => {
          for (const handler of handlers as Array<Partial<EntitySelectorHandlers>>) {
            handler.onSelect?.(id);
          }
        };
      }

      if ((handlers as Array<Partial<EntitySelectorHandlers>>).some((h) => h.onCancel)) {
        result.onCancel = () => {
          for (const handler of handlers as Array<Partial<EntitySelectorHandlers>>) {
            handler.onCancel?.();
          }
        };
      }

      return result as FieldHandlers<T>;
    };

    switch (fieldOptionsFirst.type) {
      case 'label':
      case 'row':
        throw new Error(
          'Field option type=label cannot be processed by SelectionInspectorManager.collapseFieldOptions',
        );
      case 'read-only':
        return {
          type: 'read-only',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as unknown as Array<FieldHandlers<string>>),
        };
      case 'spacing':
        return {
          type: 'spacing',
          key: fieldOptionsFirst.key,
          width: fieldOptionsFirst.width,
          handlers: combineHandlers(handlers as unknown as Array<FieldHandlers<void>>),
        };
      case 'number':
        return {
          type: 'number',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as Array<FieldHandlers<string>>),
        };
      case 'length':
        return {
          type: 'length',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          readOnlyUnit: fieldOptionsFirst.readOnlyUnit,
          handlers: combineHandlers(handlers as Array<FieldHandlers<Length>>),
        };
      case 'angle':
        return {
          type: 'angle',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as Array<FieldHandlers<Angle>>),
        };
      case 'render-order':
        // Only include a geometry id (which allows for rendering the "context" on the render order
        // slider) if all geometry ids are identical. Otherwise omit the context on the slider.
        const allGeometryIdsSame = fieldOptions.every((opt) => {
          if (opt.type !== 'render-order') {
            return false;
          }
          return opt.geometryId.every((id) => id === fieldOptionsFirst.geometryId[0]);
        });

        return {
          type: 'render-order',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          geometryId: allGeometryIdsSame ? fieldOptionsFirst.geometryId[0] : undefined,
          handlers: combineHandlers(handlers as Array<FieldHandlers<number>>),
        };
      case 'color':
        return {
          type: 'color',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as Array<FieldHandlers<number | null>>),
        };
      case 'link-dimensions-button':
        return {
          type: 'link-dimensions-button',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as Array<FieldHandlers<void>>),
        };
      case 'button':
        return {
          type: 'button',
          key: fieldOptionsFirst.key,
          label: fieldOptionsFirst.label,
          handlers: combineHandlers(handlers as Array<FieldHandlers<void>>),
        };
      case 'polygon-points':
        return {
          type: 'polygon-points',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          isPolygonFilledDueToFilter: fieldOptionsFirst.isPolygonFilledDueToFilter,
          // NOTE: Do NOT try to combine polygon points handlers
          // Rendering multiple polygons will fall back to type=heterogeneous
          handlers: handlers[0] as PolygonPointsHandlers,
        };
      case 'constraint-endpoint':
        return {
          type: 'constraint-endpoint',
          key: fieldOptionsFirst.key,
          label: fieldOptionsFirst.label,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          handlers: combineHandlers(handlers as Array<FieldHandlers<ConstraintEndpoint>>),
        };
      case 'choices':
        return {
          type: 'choices',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          options: fieldOptionsFirst.options,
          handlers: combineHandlers(handlers as Array<FieldHandlers<string>>),
        };
      case 'entity-selector':
        return {
          type: 'entity-selector',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
          clearable: fieldOptionsFirst.clearable,
          isPicking: this.entityPickActive && fieldOptionsFirst.key === this.entityPickFieldKey,
          handlers: combineHandlers(
            handlers as unknown as Array<FieldHandlers<Entity['id'] | null>>,
          ) as EntitySelectorHandlers,
        };
      default:
        fieldOptionsFirst satisfies never;
        throw new Error(
          `SelectionInspectorManager.collapseFieldOptions: Unknown field options type=${(fieldOptionsFirst as any).type}`,
        );
    }
  }

  private aggregateFieldValue<F extends FieldOptions | FieldOptionsRow | FieldOptionsLabel>(
    entries: Array<F>,
    key: string,
  ): Field<OptionsToSingle<F>> {
    if (entries.length === 0) {
      return { type: 'heterogeneous', key };
    } else if (entries.length === 1) {
      if (entries[0].type === 'row') {
        return this.aggregateRows([entries[0]]);
      }
      if (entries[0].type === 'label') {
        return this.aggregateLabels([entries[0]]);
      }
      return this.collapseFieldOptions(entries) as Field<OptionsToSingle<F>>; // homogeneous
    }

    if (!entries.every((e) => e.type === entries[0].type)) {
      return { type: 'heterogeneous', key };
    }

    // No 'value' key = use first entry
    if (!('value' in entries[0])) {
      if (entries[0].type === 'row') {
        return this.aggregateRows(entries as Array<FieldOptionsRow>);
      }
      if (entries[0].type === 'label') {
        return this.aggregateLabels(entries as Array<FieldOptionsLabel>);
      }
      return this.collapseFieldOptions(entries) as Field<OptionsToSingle<F>>; // homogeneous
    }

    const combined = entries.reduce((acc, e) => {
      switch (e.type) {
        case 'read-only':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'render-order':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'number':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'length':
          return (acc as typeof e.value).flatMap((value) => {
            return e.value.filter(
              (eValue) => eValue.type === value.type && eValue.magnitude === value.magnitude,
            );
          });
        case 'angle':
          return (acc as typeof e.value).flatMap((value) => {
            return e.value.filter(
              (eValue) => eValue.type === value.type && eValue.magnitude === value.magnitude,
            );
          });
        case 'color':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'entity-selector':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'polygon-points':
          // Polygon points will not merge together with other polygon points
          return [];
        case 'constraint-endpoint':
        case 'choices':
          // Not mergeable across multiple selections; falls through to heterogeneous
          return [];
        case 'link-dimensions-button':
        case 'button':
        case 'row':
        case 'label':
        case 'spacing':
          return acc;
        default:
          e satisfies never;
          throw new Error(`Unknown e.type of ${(e as any).type}`);
      }
    }, entries[0].value);

    if (combined.length === 1) {
      return this.collapseFieldOptions(entries, combined[0]) as Field<OptionsToSingle<F>>; // homogeneous
    } else {
      return { type: 'heterogeneous', key, fieldType: entries[0]?.type };
    }
  }

  /** Dispatches a single entity + component to that component's field builder. Each component owns
   * the knowledge of which fields it contributes; this method only routes and guards. */
  private computeFieldsForComponent(
    entity: Entity,
    Component: NonNullable<ReturnType<typeof getComponentByKey>>,
  ): FieldOptionsList {
    switch (Component.key) {
      case GeometryComponent.key: {
        if (!Entity.hasComponent(entity, GeometryComponent)) {
          return [];
        }
        return GeometryComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case FillColorComponent.key: {
        if (!Entity.hasComponent(entity, FillColorComponent)) {
          return [];
        }
        return FillColorComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case RenderOrderComponent.key: {
        if (!Entity.hasComponent(entity, RenderOrderComponent)) {
          return [];
        }
        return RenderOrderComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case FrameComponent.key: {
        if (!Entity.hasComponent(entity, FrameComponent)) {
          return [];
        }
        return FrameComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case DatumComponent.key: {
        if (!Entity.hasComponent(entity, DatumComponent)) {
          return [];
        }
        return DatumComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case FilterComponent.key: {
        if (!Entity.hasComponent(entity, FilterComponent)) {
          return [];
        }
        return FilterComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case ConstraintComponent.key: {
        if (!Entity.hasComponent(entity, ConstraintComponent)) {
          return [];
        }
        return ConstraintComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      case LinkDimensionsComponent.key: {
        // LinkDimensionsComponent is consumed within GeometryComponent to conditionally show the
        // link button. It does not render its own standalone fields.
        return [];
      }
      case AnchorPointComponent.key: {
        if (!Entity.hasComponent(entity, AnchorPointComponent)) {
          return [];
        }
        return AnchorPointComponent.computeSelectionInspectorFields(entity, this.makeContext());
      }
      default:
        Component satisfies never;
        return [];
    }
  }
}
