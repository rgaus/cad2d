import { EventEmitter } from 'eventemitter3';
import {
  ConstraintComponent,
  DatumComponent,
  Entity,
  FillColorComponent,
  FrameComponent,
  GeometryComponent,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '../entity';
import { GeometryStore } from '../entity/GeometryStore';
import { FilterComponent } from '../entity/components/FilterComponent';
import { GeometryData } from '../entity/geometry';
import { Sheet } from '../sheet/Sheet';
import { SelectionManager } from '../tools/SelectionManager';
import { Angle } from '../units/angle';
import { Length } from '../units/length';
import { SheetPosition } from '../viewport/types';
import { HistoryManager } from '../history/HistoryManager';

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

function linkDimensionsButton(key: string, value: boolean, handlers?: FieldHandlers<void>): SelectionInspectorFieldOptions {
  return { type: 'link-dimensions-button', key, value: [value], handlers: [handlers ?? {}] };
}

function button(
  key: string,
  label: string | SelectionInspectorIcon,
  handlers?: FieldHandlers<void>,
): SelectionInspectorFieldOptions {
  return { type: 'button', key, label, handlers: [handlers ?? {}] };
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
  | { type: 'length'; value: Length; }
  | { type: 'angle'; value: Angle }
  | { type: 'render-order'; value: number }
  | { type: 'color'; value: number | null }
  | { type: 'link-dimensions-button'; value: boolean; }
>;

type SelectionInspectorManagerEvents = {
  fieldsChange: (fields: Array<Field>) => void;
  workingFieldDataChange: (fieldData: WorkingFieldData) => void;
};

export class SelectionInspectorManager extends EventEmitter<SelectionInspectorManagerEvents> {
  private sheet: Sheet;
  private selectionManager: SelectionManager;
  private geometryStore: GeometryStore;
  private historyManager: HistoryManager;

  private sheetDefaultUnit: Sheet['defaultUnit'];

  constructor(sheet: Sheet, selectionManager: SelectionManager, geometryStore: GeometryStore, historyManager: HistoryManager) {
    super();
    this.sheet = sheet;
    this.selectionManager = selectionManager;
    this.geometryStore = geometryStore;
    this.historyManager = historyManager;

    this.sheetDefaultUnit = sheet.defaultUnit;

    this.selectionManager.on('selectionChange', this.handleSelectionChange);
    this.sheet.on('defaultUnitChange', this.handleDefaultUnitChange);
  }

  destructor() {
    this.sheet.off('defaultUnitChange', this.handleDefaultUnitChange);
    this.selectionManager.off('selectionChange', this.handleSelectionChange);
    this.geometryStore = null as any;
    this.selectionManager = null as any;
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
      const componentKeys = Object.keys(entity.components);
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
          if (field.type === 'row') {
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
  private collapseFieldOptions<F extends SelectionInspectorFieldOptions>(
    fieldOptions: F,
    newValue?: Extract<F, { value: unknown }>['value'][0],
  ): SelectionInspectorField {
    const combineHandlers = <T extends unknown>(handlers: Array<FieldHandlers<T>>): FieldHandlers<T> => {
      const keys = new Set(handlers.flatMap((h) => Object.keys(h)));
      return Object.fromEntries(Array.from(keys).map((key) => {
        return [key as keyof FieldHandlers<T>, (t: T) => {
          this.historyManager.applyTransaction('selection-inspector-field', () => {
            console.log('HANDLERS', handlers);
            for (const handler of handlers) {
              const fn = handler[key as keyof FieldHandlers<T>];
              if (fn) {
                fn(t);
              }
            }
          }, { collapseIfSingle: true });
        }];
      }));
    };

    switch (fieldOptions.type) {
      case 'read-only':
        return {
          type: 'read-only',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'number':
        return {
          type: 'number',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'length':
        return {
          type: 'length',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          readOnlyUnit: fieldOptions.readOnlyUnit,
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'angle':
        return {
          type: 'angle',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'render-order':
        return {
          type: 'render-order',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'color':
        return {
          type: 'color',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'link-dimensions-button':
        return {
          type: 'link-dimensions-button',
          key: fieldOptions.key,
          value: (newValue as any) ?? fieldOptions.value[0],
          handlers: combineHandlers(fieldOptions.handlers),
        };
      case 'button':
        return {
          type: 'button',
          key: fieldOptions.key,
          label: fieldOptions.label,
          handlers: combineHandlers(fieldOptions.handlers),
        };
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
      return this.collapseFieldOptions(entries[0]) as Field<OptionsToSingle<F>>; // homogeneous
    }

    if (!entries.every((e) => e.type === entries[0].type)) {
      return { type: 'heterogeneous', key };
    }

    // No 'value' key = use first entry
    if (!('value' in entries[0])) {
      if (entries[0].type === 'row') {
        return this.aggregateRows(entries as Array<SelectionInspectorFieldRow>);
      }
      if (entries[0].type === 'label') {
        return this.aggregateLabels(entries as Array<SelectionInspectorLabelledField>);
      }
      return this.collapseFieldOptions(entries[0]) as Field<OptionsToSingle<F>>; // homogeneous
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

    // console.log('COMBINED', combined);
    if (combined.length === 1) {
      return this.collapseFieldOptions(entries[0], combined[0]) as Field<OptionsToSingle<F>>; // homogeneous
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
        const isLinked = Entity.hasComponent(entity, LinkDimensionsComponent) && LinkDimensionsComponent.get(entity);
        switch (geometryData.type) {
          case 'rectangle': {
            return [
              row('position', [
                labelled(
                  'x',
                  'X:',
                  length(
                    'x',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.x),
                    { readOnlyUnit: true },
                    {
                      onChange: (value) => {
                        this.workingFieldData.set('x', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('x');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }
                        const newX = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        const deltaX = newX - geometryData.upperLeft.x;

                        const upperLeft = new SheetPosition(newX, geometryData.upperLeft.y);
                        const lowerRight = new SheetPosition(geometryData.lowerRight.x + deltaX, geometryData.lowerRight.y);
                        this.geometryStore.updateByIdWithComponent(entity.id, GeometryComponent, (old) =>
                          GeometryComponent.update(old, { upperLeft, lowerRight }),
                        );
                      },
                    }
                  ),
                ),
                labelled(
                  'y',
                  'Y:',
                  length(
                    'y',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.y),
                    { readOnlyUnit: true },
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
                  ),
                ),
                linkDimensionsButton('link', isLinked),
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
                  ),
                ),
              ]),
              button('convert-to-polygon', 'To polygon...'),
            ];
          }
          case 'ellipse': {
            return [
              row('position', [
                labelled(
                  'x',
                  'X:',
                  length(
                    'x',
                    Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.x),
                    { readOnlyUnit: true },
                    {
                      onChange: (value) => {
                        this.workingFieldData.set('x', { type: 'length', value });
                        this.emit('workingFieldDataChange', new Map(this.workingFieldData));
                      },
                      onBlur: () => {
                        const fieldData = this.workingFieldData.get('x');
                        if (!fieldData || fieldData.type !== 'length') {
                          return;
                        }

                        const newCX = fieldData.value.toSheetUnits(this.sheetDefaultUnit).magnitude;
                        this.geometryStore.updateByIdWithComponent(entity.id, GeometryComponent, (old) =>
                          GeometryComponent.update(old, {
                            center: new SheetPosition(newCX, GeometryComponent.get(old).center.y),
                          }),
                        );
                      },
                    },
                  ),
                ),
                labelled(
                  'y',
                  'Y:',
                  length('y', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.y), {
                    readOnlyUnit: true,
                  }),
                ),
              ]),
              row('radius', [
                labelled(
                  'rx',
                  'RX:',
                  length('rx', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusX), {
                    readOnlyUnit: true,
                  }),
                ),
                linkDimensionsButton('link', isLinked),
                labelled(
                  'ry',
                  'RY:',
                  length('ry', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusY), {
                    readOnlyUnit: true,
                  }),
                ),
              ]),
              button('convert-to-polygon', 'To polygon...'),
            ];
          }
          case 'polygon':
            // TODO: add this
            return [];
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
        return [row('fillColor', [labelled('fillColor', 'Fill:', color('fillColor', fillColor))])];
      }
      case RenderOrderComponent.key: {
        if (!Entity.hasComponent(entity, RenderOrderComponent)) {
          return [];
        }
        const renderOrderValue = RenderOrderComponent.get(entity);
        return [
          row('renderOrder', [labelled('renderOrder', 'Render order:', renderOrder('renderOrder', renderOrderValue))]),
        ];
      }
      case FrameComponent.key: {
        if (!Entity.hasComponent(entity, FrameComponent)) {
          return [];
        }
        const frameData = FrameComponent.get(entity);
        return [
          row('position', [
            labelled(
              'x',
              'X:',
              length('x', Length.fromSheetUnits(this.sheetDefaultUnit, frameData.upperLeft.x), {
                readOnlyUnit: true,
              }),
            ),
            labelled(
              'y',
              'Y:',
              length('y', Length.fromSheetUnits(this.sheetDefaultUnit, frameData.upperLeft.y), {
                readOnlyUnit: true,
              }),
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
        return [
          row('position', [
            labelled(
              'x',
              'X:',
              length('x', Length.fromSheetUnits(this.sheetDefaultUnit, datumData.x), {
                readOnlyUnit: true,
              }),
            ),
            labelled(
              'y',
              'Y:',
              length('y', Length.fromSheetUnits(this.sheetDefaultUnit, datumData.y), {
                readOnlyUnit: true,
              }),
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
          case 'mirror':
            return [
              row('point-a', [
                labelled(
                  'ax',
                  'AX:',
                  length('ax', Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointA.x), {
                    readOnlyUnit: true,
                  }),
                ),
                labelled(
                  'ay',
                  'AY:',
                  length('ay', Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointA.y), {
                    readOnlyUnit: true,
                  }),
                ),
              ]),
              row('point-b', [
                labelled(
                  'bx',
                  'BX:',
                  length('bx', Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointB.x), {
                    readOnlyUnit: true,
                  }),
                ),
                labelled(
                  'by',
                  'BY:',
                  length('by', Length.fromSheetUnits(this.sheetDefaultUnit, filterData.pointB.y), {
                    readOnlyUnit: true,
                  }),
                ),
              ]),
            ];
          case 'fillet':
          case 'chamfer': {
            if (filterData.geometryType === 'polygon') {
              return [
                row('offset', [
                  labelled(
                    'offset',
                    'Offset:',
                    length('offset', filterData.offset, { readOnlyUnit: true }),
                  ),
                ]),
                row('points', [
                  labelled('a', 'A:', number('pointAIndex', filterData.pointAIndex)),
                  labelled('c', 'C:', number('pointCenterIndex', filterData.pointCenterIndex)),
                  labelled('b', 'B:', number('pointBIndex', filterData.pointBIndex)),
                ]),
              ];
            } else {
              // geometryType === 'rectangle' -- use readOnly for keypoints since toggle groups
              // would need a new field type.
              return [
                row('offset', [labelled(
                  'offset',
                  'Offset:',
                  length('offset', filterData.offset, { readOnlyUnit: true }),
                )]),
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
            switch (filterData.mode) {
              case 'grid':
                return [
                  row('repeats', [labelled('repeats', 'Repeats:', [
                    number('xRepeats', filterData.xRepeats),
                    number('yRepeats', filterData.yRepeats),
                  ])]),
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
                      ),
                    ),
                    labelled(
                      'y',
                      'Y:',
                      length(
                        'y',
                        Length.fromSheetUnits(this.sheetDefaultUnit, filterData.center.y),
                        { readOnlyUnit: true },
                      ),
                    ),
                  ]),
                  row('repeats', [labelled('repeats', 'Repeats:', number('repeats', filterData.repeats.count))]),
                  row('radius', [labelled(
                    'radius',
                    'Radius:',
                    length(
                      'radius',
                      Length.fromSheetUnits(this.sheetDefaultUnit, filterData.radius),
                      { readOnlyUnit: true },
                    ),
                  )]),
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
        return [];
    }
  }
}
