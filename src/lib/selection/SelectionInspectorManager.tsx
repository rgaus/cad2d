import { EventEmitter } from 'eventemitter3';
import { ActionsManager } from '../actions/ActionsManager';
import {
  ConstraintComponent,
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
import { FilterData } from '../entity/filters';
import { GeometryData } from '../entity/geometry';
import { PolygonData, PolygonSegment } from '../entity/geometry/polygon';
import { HistoryManager } from '../history/HistoryManager';
import { UndoEntry } from '../history/types';
import { BoundingBox } from '../math';
import { Sheet } from '../sheet/Sheet';
import { SelectionManager } from '../tools/SelectionManager';
import { Angle } from '../units/angle';
import { Length } from '../units/length';
import { SheetPosition } from '../viewport/types';
import { computeOpenAtIndex } from './polygon-point-row';

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
  ]) {
    if (component.key === key) {
      return component;
    }
  }
  return null;
}

type SelectionInspectorIcon = { type: 'icon'; icon: React.ReactNode };
function icon(icon: React.ReactNode): SelectionInspectorIcon {
  return { type: 'icon', icon };
}

type FieldHandlers<Value> = {
  onClick?: () => void;
  onChange?: (newValue: Value) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (key: string) => void;
};

type PolygonPointsHandlers = {
  onPointXChange?: (index: number, len: Length) => void;
  onPointYChange?: (index: number, len: Length) => void;
  onPointXBlur?: (index: number) => void;
  onPointYBlur?: (index: number) => void;
  onControlPointChange?: (
    index: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    axis: 'x' | 'y',
    len: Length,
  ) => void;
  onDeletePoint?: (index: number) => void;
  onInsertPoint?: (index: number) => void;
  onPointTypeChange?: (index: number, type: PolygonSegment['type']) => void;
  onPointMouseEnter?: (index: number) => void;
  onPointMouseLeave?: (index: number) => void;
  onOpenAtIndexMouseEnter?: () => void;
  onOpenAtIndexMouseLeave?: () => void;
  onOpenAtIndexMouseDown?: () => void;
  onCloseOpen?: () => void;
};

export type SelectionInspectorField =
  | { type: 'read-only'; key: string; value: string; handlers: FieldHandlers<string> }
  | { type: 'number'; key: string; value: string; handlers: FieldHandlers<string> }
  | {
      type: 'length';
      key: string;
      value: Length;
      readOnlyUnit: boolean;
      handlers: FieldHandlers<Length>;
    }
  | { type: 'angle'; key: string; value: Angle; handlers: FieldHandlers<Angle> }
  | { type: 'render-order'; value: number; key: string; handlers: FieldHandlers<number> }
  | { type: 'color'; key: string; value: number | null; handlers: FieldHandlers<number | null> }
  | {
      type: 'link-dimensions-button';
      key: string;
      value: boolean;
      handlers: FieldHandlers<void>;
    }
  | {
      type: 'button';
      label: string | SelectionInspectorIcon;
      key: string;
      handlers: FieldHandlers<void>;
    }
  | {
      type: 'polygon-points';
      key: string;
      value: PolygonData;
      isPolygonFilledDueToFilter: boolean;
      handlers: PolygonPointsHandlers;
    };

export type SelectionInspectorFieldOptions =
  | { type: 'read-only'; key: string; value: Array<string>; handlers: Array<FieldHandlers<string>> }
  | { type: 'number'; key: string; value: Array<string>; handlers: Array<FieldHandlers<string>> }
  | {
      type: 'length';
      key: string;
      value: Array<Length>;
      readOnlyUnit: boolean;
      handlers: Array<FieldHandlers<Length>>;
    }
  | { type: 'angle'; key: string; value: Array<Angle>; handlers: Array<FieldHandlers<Angle>> }
  | {
      type: 'render-order';
      value: Array<number>;
      key: string;
      handlers: Array<FieldHandlers<number>>;
    }
  | {
      type: 'color';
      key: string;
      value: Array<number | null>;
      handlers: Array<FieldHandlers<number | null>>;
    }
  | {
      type: 'link-dimensions-button';
      key: string;
      value: Array<boolean>;
      handlers: Array<FieldHandlers<void>>;
    }
  | {
      type: 'button';
      label: string | SelectionInspectorIcon;
      key: string;
      handlers: Array<FieldHandlers<void>>;
    }
  | {
      type: 'polygon-points';
      key: string;
      value: Array<PolygonData>;
      isPolygonFilledDueToFilter: boolean;
      handlers: Array<PolygonPointsHandlers>;
    };

function readOnly(
  key: string,
  text: string,
  handlers?: FieldHandlers<string>,
): SelectionInspectorFieldOptions {
  return { type: 'read-only', key, value: [text], handlers: [handlers ?? {}] };
}

function number(
  key: string,
  value: number,
  handlers?: FieldHandlers<string>,
): SelectionInspectorFieldOptions {
  return { type: 'number', key, value: [`${value}`], handlers: [handlers ?? {}] };
}

function length(
  key: string,
  value: Length,
  options?: { readOnlyUnit?: boolean },
  handlers?: FieldHandlers<Length>,
): SelectionInspectorFieldOptions {
  return {
    type: 'length',
    key,
    value: [value],
    readOnlyUnit: options?.readOnlyUnit ?? false,
    handlers: [handlers ?? {}],
  };
}

function angle(
  key: string,
  value: Angle,
  handlers?: FieldHandlers<Angle>,
): SelectionInspectorFieldOptions {
  return { type: 'angle', key, value: [value], handlers: [handlers ?? {}] };
}

function renderOrder(
  key: string,
  renderOrder: number,
  handlers?: FieldHandlers<number>,
): SelectionInspectorFieldOptions {
  return { type: 'render-order', key, value: [renderOrder], handlers: [handlers ?? {}] };
}

function color(
  key: string,
  color: number | null,
  handlers?: FieldHandlers<number | null>,
): SelectionInspectorFieldOptions {
  return { type: 'color', key, value: [color], handlers: [handlers ?? {}] };
}

function linkDimensionsButton(
  key: string,
  value: boolean,
  handlers?: FieldHandlers<void>,
): SelectionInspectorFieldOptions {
  return { type: 'link-dimensions-button', key, value: [value], handlers: [handlers ?? {}] };
}

function button(
  key: string,
  label: string | SelectionInspectorIcon,
  handlers?: FieldHandlers<void>,
): SelectionInspectorFieldOptions {
  return { type: 'button', key, label, handlers: [handlers ?? {}] };
}

function polygonPoints(
  key: string,
  value: PolygonData,
  isPolygonFilledDueToFilter: boolean,
  handlers?: PolygonPointsHandlers,
): SelectionInspectorFieldOptions {
  return {
    type: 'polygon-points',
    key,
    value: [value],
    isPolygonFilledDueToFilter,
    handlers: [handlers ?? {}],
  };
}

export type SelectionInspectorLabelledField = Label<SelectionInspectorFieldOptions>;

function labelled(
  key: string,
  label: string,
  fields: SelectionInspectorFieldOptions | Array<SelectionInspectorFieldOptions>,
): SelectionInspectorLabelledField {
  return { type: 'label', key, label, fields: Array.isArray(fields) ? fields : [fields] };
}

export type SelectionInspectorFieldRow = Row<
  SelectionInspectorLabelledField | SelectionInspectorFieldOptions
>;

function row(
  key: string,
  fields: Array<SelectionInspectorLabelledField | SelectionInspectorFieldOptions>,
): SelectionInspectorFieldRow {
  return { type: 'row', key, fields };
}

type Variance<T extends { type: string }> =
  | {
      type: 'heterogeneous';
      key: string;
      fieldType?: SelectionInspectorFieldRow['fields'][0]['type'];
    }
  | T;

type Row<T> = { type: 'row'; key: string; fields: Array<T> };

type Label<T> = { type: 'label'; key: string; label: string; fields: Array<T> };

export type FieldRow = Row<Variance<FieldLabel | SelectionInspectorField>>;
export type FieldLabel = Label<Variance<SelectionInspectorField>>;

/** Map from a type which contains a list of fields at each leaf to a type which has only a single
 * field at each leaf. */
type OptionsToSingle<
  F extends
    | SelectionInspectorFieldOptions
    | SelectionInspectorFieldRow
    | SelectionInspectorLabelledField,
> = F extends SelectionInspectorFieldOptions
  ? SelectionInspectorField
  : F extends SelectionInspectorFieldRow
    ? FieldRow
    : F extends SelectionInspectorLabelledField
      ? FieldLabel
      : F;

export type Field<F extends { type: string } = SelectionInspectorField | FieldRow> =
  | Variance<F>
  | FieldRow
  | FieldLabel;

export type WorkingFieldData = Map<
  string /* key */,
  | { type: 'number'; value: string }
  | { type: 'length'; value: Length }
  | { type: 'angle'; value: Angle }
  | { type: 'render-order'; value: number }
  | { type: 'color'; value: number | null }
  | { type: 'link-dimensions-button'; value: boolean }
>;

type SelectionInspectorManagerEvents = {
  fieldsChange: (fields: Array<Field>) => void;
  workingFieldDataChange: (fieldData: WorkingFieldData) => void;
  openAtIndexDragChange: (dragging: boolean) => void;
};

export class SelectionInspectorManager extends EventEmitter<SelectionInspectorManagerEvents> {
  private sheet: Sheet;
  private selectionManager: SelectionManager;
  private geometryStore: GeometryStore;
  private historyManager: HistoryManager;
  private actionsManager: ActionsManager | null = null;

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

    this.selectionManager.on('selectionChange', this.handleSelectionChange);
    this.sheet.on('defaultUnitChange', this.handleDefaultUnitChange);
    this.geometryStore.on('geometryUpdated', this.handleGeometryUpdate);
  }

  destructor() {
    this.openAtIndexDragCleanup?.();
    this.openAtIndexDragCleanup = null;
    this.geometryStore.off('geometryUpdated', this.handleGeometryUpdate);
    this.sheet.off('defaultUnitChange', this.handleDefaultUnitChange);
    this.selectionManager.off('selectionChange', this.handleSelectionChange);
    this.actionsManager = null;
    this.geometryStore = null as any;
    this.selectionManager = null as any;
  }

  setActionsManager(actionsManager: ActionsManager) {
    this.actionsManager = actionsManager;
  }

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
      onBlur: () => {
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
    this.selectedIds = ids;
    this.recomputeFields();
  };

  handleDefaultUnitChange = (defaultUnit: Sheet['defaultUnit']) => {
    this.sheetDefaultUnit = defaultUnit;
    this.recomputeFields();
  };

  handleGeometryUpdate = (entity: Entity) => {
    if (!this.selectedIds.includes(entity.id)) {
      return;
    }
    if (this.dragOriginals.has(entity.id)) {
      return;
    }
    this.recomputeFields();
  };

  private workingFieldData: WorkingFieldData = new Map();

  fields: Array<Field> = [];
  recomputeFields() {
    const fields = new Map<
      string,
      Array<SelectionInspectorFieldOptions | SelectionInspectorFieldRow>
    >();
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
        // console.log('INITIAL:', computed, fields);
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
          // console.log('MATCH', match);
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

    console.log(
      'FIELDS:',
      fieldFrequencies,
      fieldKeyOrder.map((key) => fields.get(key)!),
    );

    const processed = fieldKeyOrder.flatMap((key) => {
      if (fieldFrequencies.get(key) !== this.selectedIds.length) {
        return [];
      }
      return [this.aggregateFieldValue(fields.get(key)!, key)];
    });
    console.log('PROCESSED:', processed);

    // Erase any fields whicha re currently being filled out
    this.workingFieldData.clear();
    this.emit('workingFieldDataChange', new Map());

    this.fields = processed;
    this.emit('fieldsChange', processed);
  }

  private aggregateRows(
    rows: Array<SelectionInspectorFieldRow>,
  ): Row<Variance<SelectionInspectorField | FieldLabel>> {
    // console.log('AGGR ROWS', rows);
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
        // console.log('FIELDS FOR KEYS ACROSS ROWS:', key, fieldsForKeyAcrossRows);
        return this.aggregateFieldValue(fieldsForKeyAcrossRows, key) as Variance<
          SelectionInspectorField | FieldLabel
        >;
      }),
    };
  }

  private aggregateLabels(entries: Array<SelectionInspectorLabelledField>): FieldLabel {
    // console.log('AGGR LABELS', entries);
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
        // console.log('FIELDS FOR KEYS ACROSS LABELS:', key, fieldsForKeyAcrossLabels);
        return this.aggregateFieldValue(
          fieldsForKeyAcrossLabels,
          key,
        ) as Variance<SelectionInspectorField>;
      }),
    };
  }

  /** Takes an "options" type, and collapses it into a single value version. Uses either the first
   * entry in the options type as the new value, or if specified, {@link newValue}. */
  private collapseFieldOptions<
    F extends
      | SelectionInspectorFieldOptions
      | SelectionInspectorFieldRow
      | SelectionInspectorLabelledField,
  >(
    fieldOptions: Array<F>,
    newValue?: Extract<F, { value: unknown }>['value'][0],
  ): SelectionInspectorField {
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

    // console.log('COMBINE', fieldOptions.handlers);
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
        return {
          type: 'render-order',
          key: fieldOptionsFirst.key,
          value: (newValue as any) ?? fieldOptionsFirst.value[0],
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
      default:
        fieldOptionsFirst satisfies never;
        throw new Error(
          `SelectionInspectorManager.collapseFieldOptions: Unknown field options type=${(fieldOptionsFirst as any).type}`,
        );
    }
  }

  private aggregateFieldValue<
    F extends
      | SelectionInspectorFieldOptions
      | SelectionInspectorFieldRow
      | SelectionInspectorLabelledField,
  >(entries: Array<F>, key: string): Field<OptionsToSingle<F>> {
    // console.log('AGGR', entries);
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

    console.log('>>>', entries[0]);
    // No 'value' key = use first entry
    if (!('value' in entries[0])) {
      if (entries[0].type === 'row') {
        return this.aggregateRows(entries as Array<SelectionInspectorFieldRow>);
      }
      if (entries[0].type === 'label') {
        return this.aggregateLabels(entries as Array<SelectionInspectorLabelledField>);
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
        case 'polygon-points':
          // Polygon points will not merge together with other polygon points
          return [];
        case 'link-dimensions-button':
        case 'button':
        case 'row':
        case 'label':
          return acc;
        default:
          e satisfies never;
          throw new Error(`Unknown e.type of ${(e as any).type}`);
      }
    }, entries[0].value);

    console.log('COMBINED', combined);
    if (combined.length === 1) {
      return this.collapseFieldOptions(entries, combined[0]) as Field<OptionsToSingle<F>>; // homogeneous
    } else {
      return { type: 'heterogeneous', key, fieldType: entries[0]?.type };
    }
  }

  private computeFieldsForComponent(
    entity: Entity,
    Component: NonNullable<ReturnType<typeof getComponentByKey>>,
  ): Array<SelectionInspectorFieldOptions | SelectionInspectorFieldRow> {
    switch (Component.key) {
      case GeometryComponent.key: {
        if (!Entity.hasComponent(entity, GeometryComponent)) {
          return [];
        }
        const geometryData = GeometryComponent.get<GeometryData>(entity);
        const isLinked =
          Entity.hasComponent(entity, LinkDimensionsComponent) &&
          LinkDimensionsComponent.get(entity);
        switch (geometryData.type) {
          case 'rectangle': {
            const id = entity.id;
            return [
              row('position', [
                labelled(
                  'x',
                  'X:',
                  length(
                    'x',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.x),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'x', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'rectangle') {
                        return null;
                      }
                      const newX = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const deltaX = newX - currentGeom.upperLeft.x;
                      const upperLeft = new SheetPosition(newX, currentGeom.upperLeft.y);
                      const lowerRight = new SheetPosition(
                        currentGeom.lowerRight.x + deltaX,
                        currentGeom.lowerRight.y,
                      );
                      return { upperLeft, lowerRight };
                    }),
                  ),
                ),
                labelled(
                  'y',
                  'Y:',
                  length(
                    'y',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.y),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'y', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'rectangle') {
                        return null;
                      }
                      const newY = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const deltaY = newY - currentGeom.upperLeft.y;
                      const upperLeft = new SheetPosition(currentGeom.upperLeft.x, newY);
                      const lowerRight = new SheetPosition(
                        currentGeom.lowerRight.x,
                        currentGeom.lowerRight.y + deltaY,
                      );
                      return { upperLeft, lowerRight };
                    }),
                  ),
                ),
              ]),
              row('dimensions', [
                labelled(
                  'width',
                  'W:',
                  length(
                    'width',
                    Length.fromSheetUnits(
                      this.sheetDefaultUnit,
                      geometryData.lowerRight.x - geometryData.upperLeft.x,
                    ),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'width', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'rectangle') {
                        return null;
                      }
                      const isLinkedNow =
                        Entity.hasComponent(current, LinkDimensionsComponent) &&
                        LinkDimensionsComponent.get(current);
                      const w = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return {
                        lowerRight: new SheetPosition(
                          currentGeom.upperLeft.x + w,
                          isLinkedNow ? currentGeom.upperLeft.y + w : currentGeom.lowerRight.y,
                        ),
                      };
                    }),
                  ),
                ),
                linkDimensionsButton('link', isLinked, {
                  onClick: () => {
                    this.actionsManager?.execute('toggle-link-dimensions');
                  },
                }),
                labelled(
                  'height',
                  'H:',
                  length(
                    'height',
                    Length.fromSheetUnits(
                      this.sheetDefaultUnit,
                      geometryData.lowerRight.y - geometryData.upperLeft.y,
                    ),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'height', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'rectangle') {
                        return null;
                      }
                      const isLinkedNow =
                        Entity.hasComponent(current, LinkDimensionsComponent) &&
                        LinkDimensionsComponent.get(current);
                      const h = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return {
                        lowerRight: new SheetPosition(
                          isLinkedNow ? currentGeom.upperLeft.x + h : currentGeom.lowerRight.x,
                          currentGeom.upperLeft.y + h,
                        ),
                      };
                    }),
                  ),
                ),
              ]),
              button('convert-to-polygon', 'To polygon...', {
                onClick: () => {
                  this.actionsManager?.execute('convert-to-polygon');
                },
              }),
            ];
          }
          case 'ellipse': {
            const id = entity.id;
            return [
              row('position', [
                labelled(
                  'x',
                  'X:',
                  length(
                    'x',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.x),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'x', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'ellipse') {
                        return null;
                      }
                      const newCX = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return { center: new SheetPosition(newCX, currentGeom.center.y) };
                    }),
                  ),
                ),
                labelled(
                  'y',
                  'Y:',
                  length(
                    'y',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.y),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'y', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'ellipse') {
                        return null;
                      }
                      const newCY = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return { center: new SheetPosition(currentGeom.center.x, newCY) };
                    }),
                  ),
                ),
              ]),
              row('radius', [
                labelled(
                  'rx',
                  'RX:',
                  length(
                    'rx',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusX),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'rx', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'ellipse') {
                        return null;
                      }
                      const isLinkedNow =
                        Entity.hasComponent(current, LinkDimensionsComponent) &&
                        LinkDimensionsComponent.get(current);
                      const rx = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return {
                        radiusX: rx,
                        radiusY: isLinkedNow ? rx : currentGeom.radiusY,
                      };
                    }),
                  ),
                ),
                linkDimensionsButton('link', isLinked, {
                  onClick: () => {
                    this.actionsManager?.execute('toggle-link-dimensions');
                  },
                }),
                labelled(
                  'ry',
                  'RY:',
                  length(
                    'ry',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusY),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'ry', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get<GeometryData>(current);
                      if (currentGeom.type !== 'ellipse') {
                        return null;
                      }
                      const isLinkedNow =
                        Entity.hasComponent(current, LinkDimensionsComponent) &&
                        LinkDimensionsComponent.get(current);
                      const ry = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      return {
                        radiusX: isLinkedNow ? ry : currentGeom.radiusX,
                        radiusY: ry,
                      };
                    }),
                  ),
                ),
              ]),
              button('convert-to-polygon', 'To polygon...', {
                onClick: () => {
                  this.actionsManager?.execute('convert-to-polygon');
                },
              }),
            ];
          }
          case 'polygon': {
            const id = entity.id;
            const bounds = BoundingBox.fromPoints(geometryData.points.map((s) => s.point));
            const isPolygonFilledDueToFilter =
              !geometryData.closed && typeof FillColorComponent.getOptional(entity) !== 'undefined';
            const pointXHandlers = this.makePolygonPointLengthHandlers(id, 'x');
            const pointYHandlers = this.makePolygonPointLengthHandlers(id, 'y');
            return [
              row('position', [
                labelled(
                  'x',
                  'X:',
                  length(
                    'x',
                    Length.fromSheetUnits(this.sheetDefaultUnit, bounds.position.x),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'x', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current || !GeometryComponent.isPolygon(current)) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get(current);
                      const newX = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const currentBounds = BoundingBox.fromPoints(
                        currentGeom.points.map((s) => s.point),
                      );
                      const deltaX = newX - currentBounds.position.x;
                      if (deltaX === 0) {
                        return null;
                      }
                      const translated = PolygonData.translate(
                        current,
                        (p) => new SheetPosition(p.x + deltaX, p.y),
                      );
                      return { points: GeometryComponent.get(translated).points };
                    }),
                  ),
                ),
                labelled(
                  'y',
                  'Y:',
                  length(
                    'y',
                    Length.fromSheetUnits(this.sheetDefaultUnit, bounds.position.y),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'y', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current || !GeometryComponent.isPolygon(current)) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get(current);
                      const newY = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const currentBounds = BoundingBox.fromPoints(
                        currentGeom.points.map((s) => s.point),
                      );
                      const deltaY = newY - currentBounds.position.y;
                      if (deltaY === 0) {
                        return null;
                      }
                      const translated = PolygonData.translate(
                        current,
                        (p) => new SheetPosition(p.x, p.y + deltaY),
                      );
                      return { points: GeometryComponent.get(translated).points };
                    }),
                  ),
                ),
              ]),
              row('dimensions', [
                labelled(
                  'width',
                  'W:',
                  length(
                    'width',
                    Length.fromSheetUnits(this.sheetDefaultUnit, bounds.width),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'width', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current || !GeometryComponent.isPolygon(current)) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get(current);
                      const w = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const currentBounds = BoundingBox.fromPoints(
                        currentGeom.points.map((s) => s.point),
                      );
                      if (w === currentBounds.width) {
                        return null;
                      }
                      const newBounds = {
                        position: currentBounds.position,
                        width: w,
                        height: currentBounds.height,
                      };
                      return {
                        points: BoundingBox.interpolatePoints(
                          currentGeom.points,
                          currentBounds,
                          newBounds,
                        ),
                      };
                    }),
                  ),
                ),
                labelled(
                  'height',
                  'H:',
                  length(
                    'height',
                    Length.fromSheetUnits(this.sheetDefaultUnit, bounds.height),
                    { readOnlyUnit: true },
                    this.makeLengthHandlers(id, 'height', GeometryComponent, (value) => {
                      const current = this.geometryStore.getByIdWithComponent(
                        id,
                        GeometryComponent,
                      );
                      if (!current || !GeometryComponent.isPolygon(current)) {
                        return null;
                      }
                      const currentGeom = GeometryComponent.get(current);
                      const h = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                      const currentBounds = BoundingBox.fromPoints(
                        currentGeom.points.map((s) => s.point),
                      );
                      if (h === currentBounds.height) {
                        return null;
                      }
                      const newBounds = {
                        position: currentBounds.position,
                        width: currentBounds.width,
                        height: h,
                      };
                      return {
                        points: BoundingBox.interpolatePoints(
                          currentGeom.points,
                          currentBounds,
                          newBounds,
                        ),
                      };
                    }),
                  ),
                ),
              ]),
              polygonPoints('points', geometryData, isPolygonFilledDueToFilter, {
                onPointXChange: pointXHandlers.onChange,
                onPointYChange: pointYHandlers.onChange,
                onPointXBlur: pointXHandlers.onBlur,
                onPointYBlur: pointYHandlers.onBlur,
                onControlPointChange: (index, pointKey, axis, len) => {
                  const current = this.geometryStore.getByIdWithComponent(id, GeometryComponent);
                  if (!current || !GeometryComponent.isPolygon(current)) {
                    return;
                  }
                  const polygonData = GeometryComponent.get(current);
                  const beforePoint = (polygonData.points[index] as any)[pointKey];
                  const sheetVal = len.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  const afterPoint =
                    axis === 'x'
                      ? new SheetPosition(sheetVal, beforePoint.y)
                      : new SheetPosition(beforePoint.x, sheetVal);
                  this.historyManager.apply(
                    UndoEntry.polygonMoveControlPoint(id, index, pointKey, beforePoint, afterPoint),
                  );
                },
                onDeletePoint: (index) => {
                  this.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
                    if (!GeometryComponent.isPolygon(old)) {
                      return old;
                    }
                    const oldData = GeometryComponent.get(old);
                    return GeometryComponent.update(old, {
                      points: oldData.points.filter((_, i) => i !== index),
                    });
                  });
                },
                onInsertPoint: (index) => {
                  const current = this.geometryStore.getByIdWithComponent(id, GeometryComponent);
                  if (!current || !GeometryComponent.isPolygon(current)) {
                    return;
                  }
                  const polygonData = GeometryComponent.get(current);
                  const seg = polygonData.points[index];
                  const nextSeg = polygonData.points[index + 1];
                  if (!seg || !nextSeg) {
                    return;
                  }
                  const midX = (seg.point.x + nextSeg.point.x) / 2;
                  const midY = (seg.point.y + nextSeg.point.y) / 2;
                  this.geometryStore.addPointOnLineSegmentEdge(
                    id,
                    index,
                    new SheetPosition(midX, midY),
                  );
                },
                onPointTypeChange: (index, type) => {
                  if (index === 0) {
                    // Point at index=0 must always stay a point
                    return;
                  }
                  this.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
                    if (!GeometryComponent.isPolygon(old)) {
                      return old;
                    }
                    const oldData = GeometryComponent.get(old);
                    const current = oldData.points[index];
                    if (!current || current.type === type) {
                      return old;
                    }
                    const points = oldData.points.map((seg, i) => {
                      if (i !== index) {
                        return seg;
                      }
                      const previousSeg = i > 0 ? oldData.points[i - 1] : oldData.points.at(-1);
                      if (!previousSeg) {
                        return seg;
                      }
                      return PolygonSegment.changePointType(seg, previousSeg, type);
                    });
                    return GeometryComponent.update(old, { points });
                  });
                },
                onOpenAtIndexMouseDown: () => {
                  const current = this.geometryStore.getByIdWithComponent(id, GeometryComponent);
                  if (!current || !GeometryComponent.isPolygon(current)) {
                    return;
                  }
                  const polygonData = GeometryComponent.get(current);
                  const initialOpenAtIndex = polygonData.openAtIndex;
                  const initialPoints = polygonData.points;
                  let newOpenAtIndex = initialOpenAtIndex;
                  let deltaYPx = 0;

                  this.emit('openAtIndexDragChange', true);

                  const onMouseMove = (e: MouseEvent) => {
                    deltaYPx += e.movementY;
                    newOpenAtIndex = computeOpenAtIndex(
                      initialOpenAtIndex,
                      initialPoints,
                      deltaYPx,
                    );
                    this.geometryStore.updateByIdWithComponentDirect(id, GeometryComponent, (old) =>
                      GeometryComponent.update(old, { openAtIndex: newOpenAtIndex }),
                    );
                  };

                  const cleanup = () => {
                    window.removeEventListener('mousemove', onMouseMove);
                    window.removeEventListener('mouseup', onMouseUp);
                    if (this.openAtIndexDragCleanup === cleanup) {
                      this.openAtIndexDragCleanup = null;
                    }
                  };

                  const onMouseUp = () => {
                    this.emit('openAtIndexDragChange', false);
                    if (newOpenAtIndex !== initialOpenAtIndex) {
                      this.historyManager.push(
                        UndoEntry.polygonOpenAtIndex(id, initialOpenAtIndex, newOpenAtIndex),
                      );
                    }
                    cleanup();
                  };

                  this.openAtIndexDragCleanup = cleanup;
                  window.addEventListener('mousemove', onMouseMove);
                  window.addEventListener('mouseup', onMouseUp);
                },
                onCloseOpen: () => {
                  this.actionsManager?.execute('open-close-polygon');
                },
              }),
            ];
          }
          default:
            geometryData satisfies never;
            return [];
        }
      }
      case FillColorComponent.key: {
        if (!Entity.hasComponent(entity, FillColorComponent)) {
          return [];
        }
        const fillColor = FillColorComponent.get(entity);
        const id = entity.id;
        return [
          row('fillColor', [
            labelled(
              'fillColor',
              'Fill:',
              color('fillColor', fillColor, {
                onChange: (value) => {
                  this.captureDragOriginal(id);
                  this.workingFieldData.set('fillColor', { type: 'color', value });
                  this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                  this.geometryStore.updateByIdWithComponentDirect(id, FillColorComponent, (old) =>
                    FillColorComponent.update(old, value),
                  );
                },
                onBlur: () => {
                  if (!this.dragOriginals.has(id)) {
                    return;
                  }
                  const fieldData = this.workingFieldData.get('fillColor');
                  if (!fieldData || fieldData.type !== 'color') {
                    return;
                  }
                  this.geometryStore.updateByIdDirect(id, this.dragOriginals.get(id)!);
                  this.geometryStore.setFillColor(id, fieldData.value);
                  this.dragOriginals.delete(id);
                },
                onKeyDown: (k) => {
                  if (k === 'Escape' && this.dragOriginals.has(id)) {
                    this.restoreDragOriginal(id);
                    this.workingFieldData.clear();
                    this.emit('workingFieldDataChange', new Map());
                    this.recomputeFields();
                  }
                },
              }),
            ),
          ]),
        ];
      }
      case RenderOrderComponent.key: {
        if (!Entity.hasComponent(entity, RenderOrderComponent)) {
          return [];
        }
        const renderOrderValue = RenderOrderComponent.get(entity);
        const id = entity.id;
        return [
          row('renderOrder', [
            labelled(
              'renderOrder',
              'Render order:',
              renderOrder('renderOrder', renderOrderValue, {
                onChange: (value) => {
                  this.captureDragOriginal(id);
                  this.workingFieldData.set('renderOrder', { type: 'render-order', value });
                  this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                  this.geometryStore.updateByIdWithComponentDirect(
                    id,
                    RenderOrderComponent,
                    (old) => RenderOrderComponent.update(old, value),
                  );
                },
                onBlur: () => {
                  if (!this.dragOriginals.has(id)) {
                    return;
                  }
                  const fieldData = this.workingFieldData.get('renderOrder');
                  if (!fieldData || fieldData.type !== 'render-order') {
                    return;
                  }
                  this.geometryStore.updateByIdDirect(id, this.dragOriginals.get(id)!);
                  this.geometryStore.setRenderOrder(id, fieldData.value);
                  this.dragOriginals.delete(id);
                },
                onKeyDown: (k) => {
                  if (k === 'Escape' && this.dragOriginals.has(id)) {
                    this.restoreDragOriginal(id);
                    this.workingFieldData.clear();
                    this.emit('workingFieldDataChange', new Map());
                    this.recomputeFields();
                  }
                },
              }),
            ),
          ]),
        ];
      }
      case FrameComponent.key: {
        if (!Entity.hasComponent(entity, FrameComponent)) {
          return [];
        }
        const frameData = FrameComponent.get(entity);
        const id = entity.id;
        return [
          row('position', [
            labelled(
              'x',
              'X:',
              length(
                'x',
                Length.fromSheetUnits(this.sheetDefaultUnit, frameData.upperLeft.x),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'x', FrameComponent, (value) => {
                  const current = this.geometryStore.getById(id);
                  if (!current || !Entity.hasComponent(current, FrameComponent)) {
                    return null;
                  }
                  const currentFrame = FrameComponent.get(current);
                  const newX = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  const deltaX = newX - currentFrame.upperLeft.x;
                  return {
                    upperLeft: new SheetPosition(newX, currentFrame.upperLeft.y),
                    lowerRight: new SheetPosition(
                      currentFrame.lowerRight.x + deltaX,
                      currentFrame.lowerRight.y,
                    ),
                  };
                }),
              ),
            ),
            labelled(
              'y',
              'Y:',
              length(
                'y',
                Length.fromSheetUnits(this.sheetDefaultUnit, frameData.upperLeft.y),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'y', FrameComponent, (value) => {
                  const current = this.geometryStore.getById(id);
                  if (!current || !Entity.hasComponent(current, FrameComponent)) {
                    return null;
                  }
                  const currentFrame = FrameComponent.get(current);
                  const newY = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  const deltaY = newY - currentFrame.upperLeft.y;
                  return {
                    upperLeft: new SheetPosition(currentFrame.upperLeft.x, newY),
                    lowerRight: new SheetPosition(
                      currentFrame.lowerRight.x,
                      currentFrame.lowerRight.y + deltaY,
                    ),
                  };
                }),
              ),
            ),
          ]),
          row('dimensions', [
            labelled(
              'w',
              'W:',
              length(
                'w',
                Length.fromSheetUnits(
                  this.sheetDefaultUnit,
                  frameData.lowerRight.x - frameData.upperLeft.x,
                ),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'w', FrameComponent, (value) => {
                  const current = this.geometryStore.getById(id);
                  if (!current || !Entity.hasComponent(current, FrameComponent)) {
                    return null;
                  }
                  const currentFrame = FrameComponent.get(current);
                  const w = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  return {
                    lowerRight: new SheetPosition(
                      currentFrame.upperLeft.x + w,
                      currentFrame.lowerRight.y,
                    ),
                  };
                }),
              ),
            ),
            labelled(
              'h',
              'H:',
              length(
                'h',
                Length.fromSheetUnits(
                  this.sheetDefaultUnit,
                  frameData.lowerRight.y - frameData.upperLeft.y,
                ),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'h', FrameComponent, (value) => {
                  const current = this.geometryStore.getById(id);
                  if (!current || !Entity.hasComponent(current, FrameComponent)) {
                    return null;
                  }
                  const currentFrame = FrameComponent.get(current);
                  const h = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  return {
                    lowerRight: new SheetPosition(
                      currentFrame.lowerRight.x,
                      currentFrame.upperLeft.y + h,
                    ),
                  };
                }),
              ),
            ),
          ]),
        ];
      }
      case DatumComponent.key: {
        if (!Entity.hasComponent(entity, DatumComponent)) {
          return [];
        }
        const datumData = DatumComponent.get(entity);
        const id = entity.id;
        return [
          row('position', [
            labelled(
              'x',
              'X:',
              length(
                'x',
                Length.fromSheetUnits(this.sheetDefaultUnit, datumData.x),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'x', DatumComponent, (value) => {
                  const current = this.geometryStore.getByIdWithComponent(id, DatumComponent);
                  if (!current) {
                    return null;
                  }
                  const currentDatum = DatumComponent.get(current);
                  const newX = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  return new SheetPosition(newX, currentDatum.y);
                }),
              ),
            ),
            labelled(
              'y',
              'Y:',
              length(
                'y',
                Length.fromSheetUnits(this.sheetDefaultUnit, datumData.y),
                { readOnlyUnit: true },
                this.makeLengthHandlers(id, 'y', DatumComponent, (value) => {
                  const current = this.geometryStore.getByIdWithComponent(id, DatumComponent);
                  if (!current) {
                    return null;
                  }
                  const currentDatum = DatumComponent.get(current);
                  const newY = value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                  return new SheetPosition(currentDatum.x, newY);
                }),
              ),
            ),
          ]),
        ];
      }
      case FilterComponent.key: {
        if (!Entity.hasComponent(entity, FilterComponent)) {
          return [];
        }
        const filterData = FilterComponent.get(entity);
        switch (filterData.type) {
          case 'mirror': {
            const filterId = entity.id;
            return [
              row('point-a', [
                labelled(
                  'ax',
                  'AX:',
                  length(
                    'ax',
                    Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointA.x),
                    {
                      readOnlyUnit: true,
                    },
                    {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('ax', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('ax');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const current = this.geometryStore.getByIdWithComponent(
                          filterId,
                          FilterComponent,
                        );
                        if (!current) {
                          return;
                        }
                        const currentFilter = FilterComponent.get(current);
                        if (currentFilter.type !== 'mirror') {
                          return;
                        }
                        const newX = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        const afterPointA = new SheetPosition(newX, currentFilter.pointA.y);
                        this.historyManager.apply(
                          UndoEntry.mirrorFilterMoveEndpoints(
                            filterId,
                            currentFilter.pointA,
                            currentFilter.pointB,
                            afterPointA,
                            currentFilter.pointB,
                          ),
                        );
                      },
                    },
                  ),
                ),
                labelled(
                  'ay',
                  'AY:',
                  length(
                    'ay',
                    Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointA.y),
                    {
                      readOnlyUnit: true,
                    },
                    {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('ay', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('ay');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const current = this.geometryStore.getByIdWithComponent(
                          filterId,
                          FilterComponent,
                        );
                        if (!current) {
                          return;
                        }
                        const currentFilter = FilterComponent.get(current);
                        if (currentFilter.type !== 'mirror') {
                          return;
                        }
                        const newY = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        const afterPointA = new SheetPosition(currentFilter.pointA.x, newY);
                        this.historyManager.apply(
                          UndoEntry.mirrorFilterMoveEndpoints(
                            filterId,
                            currentFilter.pointA,
                            currentFilter.pointB,
                            afterPointA,
                            currentFilter.pointB,
                          ),
                        );
                      },
                    },
                  ),
                ),
              ]),
              row('point-b', [
                labelled(
                  'bx',
                  'BX:',
                  length(
                    'bx',
                    Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointB.x),
                    {
                      readOnlyUnit: true,
                    },
                    {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('bx', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('bx');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const current = this.geometryStore.getByIdWithComponent(
                          filterId,
                          FilterComponent,
                        );
                        if (!current) {
                          return;
                        }
                        const currentFilter = FilterComponent.get(current);
                        if (currentFilter.type !== 'mirror') {
                          return;
                        }
                        const newX = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        const afterPointB = new SheetPosition(newX, currentFilter.pointB.y);
                        this.historyManager.apply(
                          UndoEntry.mirrorFilterMoveEndpoints(
                            filterId,
                            currentFilter.pointA,
                            currentFilter.pointB,
                            currentFilter.pointA,
                            afterPointB,
                          ),
                        );
                      },
                    },
                  ),
                ),
                labelled(
                  'by',
                  'BY:',
                  length(
                    'by',
                    Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointB.y),
                    {
                      readOnlyUnit: true,
                    },
                    {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('by', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('by');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const current = this.geometryStore.getByIdWithComponent(
                          filterId,
                          FilterComponent,
                        );
                        if (!current) {
                          return;
                        }
                        const currentFilter = FilterComponent.get(current);
                        if (currentFilter.type !== 'mirror') {
                          return;
                        }
                        const newY = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        const afterPointB = new SheetPosition(currentFilter.pointB.x, newY);
                        this.historyManager.apply(
                          UndoEntry.mirrorFilterMoveEndpoints(
                            filterId,
                            currentFilter.pointA,
                            currentFilter.pointB,
                            currentFilter.pointA,
                            afterPointB,
                          ),
                        );
                      },
                    },
                  ),
                ),
              ]),
            ];
          }
          case 'fillet':
          case 'chamfer': {
            const filterId = entity.id;
            if (filterData.geometryType === 'polygon') {
              return [
                row('offset', [
                  labelled(
                    'offset',
                    'Offset:',
                    length(
                      'offset',
                      filterData.offset,
                      { readOnlyUnit: true },
                      {
                        onChange: (value) => {
                          this.captureDragOriginal(filterId);
                          this.workingFieldData.set('offset', { type: 'length', value });
                          this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                        },
                        onKeyDown: (k) => {
                          if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                            this.restoreDragOriginal(filterId);
                            this.workingFieldData.clear();
                            this.emit('workingFieldDataChange', new Map());
                            this.recomputeFields();
                          }
                        },
                        onBlur: () => {
                          const fieldData = this.workingFieldData.get('offset');
                          if (!fieldData || fieldData.type !== 'length') {
                            return;
                          }
                          const current = this.geometryStore.getByIdWithComponent(
                            filterId,
                            FilterComponent,
                          );
                          if (!current) {
                            return;
                          }
                          const currentFilter = FilterComponent.get(current);
                          if (currentFilter.type !== 'fillet' && currentFilter.type !== 'chamfer') {
                            return;
                          }
                          this.historyManager.apply(
                            UndoEntry.filterChangeOffset(
                              filterId,
                              currentFilter.offset,
                              fieldData.value,
                            ),
                          );
                        },
                      },
                    ),
                  ),
                ]),
                row('points', [
                  labelled(
                    'a',
                    'A:',
                    number('pointAIndex', filterData.pointAIndex, {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('pointAIndex', { type: 'number', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('pointAIndex');
                        if (!fieldData || fieldData.type !== 'number') {
                          return;
                        }
                        const val = parseInt(fieldData.value, 10);
                        if (isNaN(val) || val < 0) {
                          return;
                        }
                        this.geometryStore.updateByIdWithComponentDirect(
                          filterId,
                          FilterComponent,
                          (g) =>
                            FilterComponent.update(g, { pointAIndex: val } as Partial<FilterData>),
                        );
                      },
                    }),
                  ),
                  labelled(
                    'c',
                    'C:',
                    number('pointCenterIndex', filterData.pointCenterIndex, {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('pointCenterIndex', { type: 'number', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('pointCenterIndex');
                        if (!fieldData || fieldData.type !== 'number') {
                          return;
                        }
                        const val = parseInt(fieldData.value, 10);
                        if (isNaN(val) || val < 0) {
                          return;
                        }
                        this.geometryStore.updateByIdWithComponentDirect(
                          filterId,
                          FilterComponent,
                          (g) =>
                            FilterComponent.update(g, {
                              pointCenterIndex: val,
                            } as Partial<FilterData>),
                        );
                      },
                    }),
                  ),
                  labelled(
                    'b',
                    'B:',
                    number('pointBIndex', filterData.pointBIndex, {
                      onChange: (value) => {
                        this.captureDragOriginal(filterId);
                        this.workingFieldData.set('pointBIndex', { type: 'number', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onKeyDown: (k) => {
                        if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                          this.restoreDragOriginal(filterId);
                          this.workingFieldData.clear();
                          this.emit('workingFieldDataChange', new Map());
                          this.recomputeFields();
                        }
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('pointBIndex');
                        if (!fieldData || fieldData.type !== 'number') {
                          return;
                        }
                        const val = parseInt(fieldData.value, 10);
                        if (isNaN(val) || val < 0) {
                          return;
                        }
                        this.geometryStore.updateByIdWithComponentDirect(
                          filterId,
                          FilterComponent,
                          (g) =>
                            FilterComponent.update(g, { pointBIndex: val } as Partial<FilterData>),
                        );
                      },
                    }),
                  ),
                ]),
              ];
            } else {
              // geometryType === 'rectangle' -- use readOnly for keypoints since toggle groups
              // would need a new field type.
              return [
                row('offset', [
                  labelled(
                    'offset',
                    'Offset:',
                    length(
                      'offset',
                      filterData.offset,
                      { readOnlyUnit: true },
                      {
                        onChange: (value) => {
                          this.captureDragOriginal(filterId);
                          this.workingFieldData.set('offset', { type: 'length', value });
                          this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                        },
                        onKeyDown: (k) => {
                          if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                            this.restoreDragOriginal(filterId);
                            this.workingFieldData.clear();
                            this.emit('workingFieldDataChange', new Map());
                            this.recomputeFields();
                          }
                        },
                        onBlur: () => {
                          const fieldData = this.workingFieldData.get('offset');
                          if (!fieldData || fieldData.type !== 'length') {
                            return;
                          }
                          const current = this.geometryStore.getByIdWithComponent(
                            filterId,
                            FilterComponent,
                          );
                          if (!current) {
                            return;
                          }
                          const currentFilter = FilterComponent.get(current);
                          if (currentFilter.type !== 'fillet' && currentFilter.type !== 'chamfer') {
                            return;
                          }
                          this.historyManager.apply(
                            UndoEntry.filterChangeOffset(
                              filterId,
                              currentFilter.offset,
                              fieldData.value,
                            ),
                          );
                        },
                      },
                    ),
                  ),
                ]),
                row('keypoints', [
                  labelled('a', 'A:', readOnly('pointAKeyPoint', filterData.pointAKeyPoint)),
                  labelled(
                    'c',
                    'C:',
                    readOnly('pointCenterKeyPoint', filterData.pointCenterKeyPoint),
                  ),
                  labelled('b', 'B:', readOnly('pointBKeyPoint', filterData.pointBKeyPoint)),
                ]),
              ];
            }
          }
          case 'pattern': {
            const filterId = entity.id;
            switch (filterData.mode) {
              case 'grid':
                return [
                  row('repeats', [
                    labelled('repeats', 'Repeats:', [
                      number('xRepeats', filterData.xRepeats, {
                        onChange: (value) => {
                          this.captureDragOriginal(filterId);
                          this.workingFieldData.set('xRepeats', { type: 'number', value });
                          this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                        },
                        onKeyDown: (k) => {
                          if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                            this.restoreDragOriginal(filterId);
                            this.workingFieldData.clear();
                            this.emit('workingFieldDataChange', new Map());
                            this.recomputeFields();
                          }
                        },
                        onBlur: () => {
                          const fieldData = this.workingFieldData.get('xRepeats');
                          if (!fieldData || fieldData.type !== 'number') {
                            return;
                          }
                          const val = parseInt(fieldData.value, 10);
                          if (isNaN(val) || val < 1) {
                            return;
                          }
                          this.geometryStore.updateByIdWithComponent(
                            filterId,
                            FilterComponent,
                            (g) => FilterComponent.update(g, { xRepeats: val }),
                          );
                        },
                      }),
                      number('yRepeats', filterData.yRepeats, {
                        onChange: (value) => {
                          this.captureDragOriginal(filterId);
                          this.workingFieldData.set('yRepeats', { type: 'number', value });
                          this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                        },
                        onKeyDown: (k) => {
                          if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                            this.restoreDragOriginal(filterId);
                            this.workingFieldData.clear();
                            this.emit('workingFieldDataChange', new Map());
                            this.recomputeFields();
                          }
                        },
                        onBlur: () => {
                          const fieldData = this.workingFieldData.get('yRepeats');
                          if (!fieldData || fieldData.type !== 'number') {
                            return;
                          }
                          const val = parseInt(fieldData.value, 10);
                          if (isNaN(val) || val < 1) {
                            return;
                          }
                          this.geometryStore.updateByIdWithComponent(
                            filterId,
                            FilterComponent,
                            (g) => FilterComponent.update(g, { yRepeats: val }),
                          );
                        },
                      }),
                    ]),
                  ]),
                ];
              case 'radial':
                return [
                  row('position', [
                    labelled(
                      'x',
                      'X:',
                      length(
                        'x',
                        Length.fromSheetUnits(this.sheetDefaultUnit, filterData.center.x),
                        { readOnlyUnit: true },
                        {
                          onChange: (value) => {
                            this.captureDragOriginal(filterId);
                            this.workingFieldData.set('x', { type: 'length', value });
                            this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                          },
                          onKeyDown: (k) => {
                            if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                              this.restoreDragOriginal(filterId);
                              this.workingFieldData.clear();
                              this.emit('workingFieldDataChange', new Map());
                              this.recomputeFields();
                            }
                          },
                          onBlur: () => {
                            const fieldData = this.workingFieldData.get('x');
                            if (!fieldData || fieldData.type !== 'length') {
                              return;
                            }
                            const current = this.geometryStore.getByIdWithComponent(
                              filterId,
                              FilterComponent,
                            );
                            if (!current) {
                              return;
                            }
                            const currentFilter = FilterComponent.get(current);
                            if (
                              currentFilter.type !== 'pattern' ||
                              currentFilter.mode !== 'radial'
                            ) {
                              return;
                            }
                            const newX = fieldData.value.toSheetUnits(
                              this.sheetDefaultUnit,
                            ).magnitude;
                            this.geometryStore.updateByIdWithComponent(
                              filterId,
                              FilterComponent,
                              (g) =>
                                FilterComponent.update(g, {
                                  center: new SheetPosition(newX, currentFilter.center.y),
                                }),
                            );
                          },
                        },
                      ),
                    ),
                    labelled(
                      'y',
                      'Y:',
                      length(
                        'y',
                        Length.fromSheetUnits(this.sheetDefaultUnit, filterData.center.y),
                        { readOnlyUnit: true },
                        {
                          onChange: (value) => {
                            this.captureDragOriginal(filterId);
                            this.workingFieldData.set('y', { type: 'length', value });
                            this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                          },
                          onKeyDown: (k) => {
                            if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                              this.restoreDragOriginal(filterId);
                              this.workingFieldData.clear();
                              this.emit('workingFieldDataChange', new Map());
                              this.recomputeFields();
                            }
                          },
                          onBlur: () => {
                            const fieldData = this.workingFieldData.get('y');
                            if (!fieldData || fieldData.type !== 'length') {
                              return;
                            }
                            const current = this.geometryStore.getByIdWithComponent(
                              filterId,
                              FilterComponent,
                            );
                            if (!current) {
                              return;
                            }
                            const currentFilter = FilterComponent.get(current);
                            if (
                              currentFilter.type !== 'pattern' ||
                              currentFilter.mode !== 'radial'
                            ) {
                              return;
                            }
                            const newY = fieldData.value.toSheetUnits(
                              this.sheetDefaultUnit,
                            ).magnitude;
                            this.geometryStore.updateByIdWithComponent(
                              filterId,
                              FilterComponent,
                              (g) =>
                                FilterComponent.update(g, {
                                  center: new SheetPosition(currentFilter.center.x, newY),
                                }),
                            );
                          },
                        },
                      ),
                    ),
                  ]),
                  row('repeats', [
                    labelled(
                      'repeats',
                      'Repeats:',
                      number('repeats', filterData.repeats.count, {
                        onChange: (value) => {
                          this.captureDragOriginal(filterId);
                          this.workingFieldData.set('repeats', { type: 'number', value });
                          this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                        },
                        onKeyDown: (k) => {
                          if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                            this.restoreDragOriginal(filterId);
                            this.workingFieldData.clear();
                            this.emit('workingFieldDataChange', new Map());
                            this.recomputeFields();
                          }
                        },
                        onBlur: () => {
                          const fieldData = this.workingFieldData.get('repeats');
                          if (!fieldData || fieldData.type !== 'number') {
                            return;
                          }
                          const val = parseInt(fieldData.value, 10);
                          if (isNaN(val) || val < 2) {
                            return;
                          }
                          this.geometryStore.updateByIdWithComponent(
                            filterId,
                            FilterComponent,
                            (g) =>
                              FilterComponent.update(g, {
                                repeats: { type: 'count' as const, count: val },
                              }),
                          );
                        },
                      }),
                    ),
                  ]),
                  row('radius', [
                    labelled(
                      'radius',
                      'Radius:',
                      length(
                        'radius',
                        Length.fromSheetUnits(this.sheetDefaultUnit, filterData.radius),
                        { readOnlyUnit: true },
                        {
                          onChange: (value) => {
                            this.captureDragOriginal(filterId);
                            this.workingFieldData.set('radius', { type: 'length', value });
                            this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                          },
                          onKeyDown: (k) => {
                            if (k === 'Escape' && this.dragOriginals.has(filterId)) {
                              this.restoreDragOriginal(filterId);
                              this.workingFieldData.clear();
                              this.emit('workingFieldDataChange', new Map());
                              this.recomputeFields();
                            }
                          },
                          onBlur: () => {
                            const fieldData = this.workingFieldData.get('radius');
                            if (!fieldData || fieldData.type !== 'length') {
                              return;
                            }
                            const radius = fieldData.value.toSheetUnits(
                              this.sheetDefaultUnit,
                            ).magnitude;
                            this.geometryStore.updateByIdWithComponent(
                              filterId,
                              FilterComponent,
                              (g) => FilterComponent.update(g, { radius }),
                            );
                          },
                        },
                      ),
                    ),
                  ]),
                ];
              default:
                return [];
            }
          }
          default:
            filterData satisfies never;
            return [];
        }
      }
      case ConstraintComponent.key: {
        // ConstraintComponent requires ConstraintEndpointField which is a rich custom widget
        // (toggle groups, EntityInput, etc.) that needs a new field type and FieldLeafRenderer
        // support. This will be addressed in a follow-up.
        return [];
      }
      case LinkDimensionsComponent.key: {
        // LinkDimensionsComponent is consumed within GeometryComponent to conditionally show the
        // link button. It does not render its own standalone fields.
        return [];
      }
      default:
        Component satisfies never;
        return [];
    }
  }
}
