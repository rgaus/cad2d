import { EventEmitter } from "eventemitter3";
import { SelectionManager } from "../tools/SelectionManager";
import { ConstraintComponent, DatumComponent, Entity, FillColorComponent, FrameComponent, GeometryComponent, LinkDimensionsComponent, RenderOrderComponent } from "../entity";
import { GeometryStore } from "../entity/GeometryStore";
import { FilterComponent } from "../entity/components/FilterComponent";
import { GeometryData } from "../entity/geometry";
import { LinkIcon } from "lucide-react";
import { Angle } from "../units/angle";
import { Length } from "../units/length";
import { Sheet } from "../sheet/Sheet";

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

export type SelectionInspectorField =
  | { type: 'read-only'; key: string, value: string }
  | { type: 'number'; key: string; value: number }
  | { type: 'length'; key: string; value: Length; readOnlyUnit: boolean }
  | { type: 'angle'; key: string; value: Angle }
  | { type: 'render-order'; value: number, key: string }
  | { type: 'color'; key: string; value: number | null }
  | { type: 'button'; label: string | SelectionInspectorIcon, key: string };

export type SelectionInspectorFieldOptions =
  | { type: 'read-only'; key: string, value: Array<string> }
  | { type: 'number'; key: string; value: Array<number> }
  | { type: 'length'; key: string; value: Array<Length>; readOnlyUnit: boolean }
  | { type: 'angle'; key: string; value: Array<Angle> }
  | { type: 'render-order'; value: Array<number>, key: string }
  | { type: 'color'; key: string; value: Array<number | null> }
  | { type: 'button'; label: string | SelectionInspectorIcon, key: string };

function readOnly(key: string, text: string ): SelectionInspectorFieldOptions {
  return { type: 'read-only', key, value: [text] };
}

function number(key: string, value: number): SelectionInspectorFieldOptions {
  return { type: 'number', key, value: [value] };
}

function length(key: string, value: Length, options?: { readOnlyUnit?: boolean }): SelectionInspectorFieldOptions {
  return { type: 'length', key, value: [value], readOnlyUnit: options?.readOnlyUnit ?? false };
}

function angle(key: string, value: Angle): SelectionInspectorFieldOptions {
  return { type: 'angle', key, value: [value] }
}

function renderOrder(key: string, renderOrder: number): SelectionInspectorFieldOptions {
  return { type: 'render-order', key, value: [renderOrder] };
}

function color(key: string, color: number | null): SelectionInspectorFieldOptions {
  return { type: 'color', key, value: [color] };
}

function button(key: string, label: string | SelectionInspectorIcon): SelectionInspectorFieldOptions {
  return { type: 'button', key, label }
}

export type SelectionInspectorLabelledField = Label<SelectionInspectorFieldOptions>;

function labelled(key: string, label: string, fields: SelectionInspectorFieldOptions | Array<SelectionInspectorFieldOptions>): SelectionInspectorLabelledField {
  return { type: 'label', key, label, fields: Array.isArray(fields) ? fields : [fields] };
}

export type SelectionInspectorFieldRow = Row<SelectionInspectorLabelledField | SelectionInspectorFieldOptions>;

function row(
  key: string,
  fields: Array<SelectionInspectorLabelledField | SelectionInspectorFieldOptions>
): SelectionInspectorFieldRow {
  return { type: 'row', key, fields };
}

type Variance<T extends { type: string }> = { type: 'heterogeneous'; key: string } | T;

type Row<T> = { type: 'row'; key: string; fields: Array<T> };

type Label<T> = { type: 'label'; key: string; label: string; fields: Array<T> };

export type FieldRow = Row<Variance<FieldLabel | SelectionInspectorField>>;
export type FieldLabel = Label<Variance<SelectionInspectorField>>;

/** Map from a type which contains a list of fields at each leaf to a type which has only a single
  * field at each leaf. */
type OptionsToSingle<F extends SelectionInspectorFieldOptions | SelectionInspectorFieldRow | SelectionInspectorLabelledField> =
  F extends SelectionInspectorFieldOptions ? SelectionInspectorField :
  (F extends SelectionInspectorFieldRow ? FieldRow :
    (F extends SelectionInspectorLabelledField ? FieldLabel : F))

export type Field<F extends { type: string } = SelectionInspectorField | FieldRow> =
  | Variance<F>
  | FieldRow
  | FieldLabel;

type SelectionInspectorManagerEvents = {
  fieldsChange: (fields: Array<Field>) => void;
};

export class SelectionInspectorManager extends EventEmitter<SelectionInspectorManagerEvents> {
  private sheet: Sheet;
  private selectionManager: SelectionManager;
  private geometryStore: GeometryStore;

  private sheetDefaultUnit: Sheet['defaultUnit'];

  constructor(sheet: Sheet, selectionManager: SelectionManager, geometryStore: GeometryStore) {
    super();
    this.sheet = sheet;
    this.selectionManager = selectionManager;
    this.geometryStore = geometryStore;

    this.sheetDefaultUnit = sheet.defaultUnit;

    this.selectionManager.on('selectionChange', this.handleSelectionChange);
    this.sheet.on('defaultUnitChange', this.handleDefaultUnitChange)
  }

  destructor() {
    this.sheet.off('defaultUnitChange', this.handleDefaultUnitChange);
    this.selectionManager.off('selectionChange', this.handleSelectionChange);
    this.geometryStore = null as any;
    this.selectionManager = null as any;
  }

  private selectedIds: Array<Entity['id']> = [];

  handleSelectionChange = (ids: Array<Entity['id']>) => {
    this.selectedIds = ids;
    this.recomputeFields();
  };

  handleDefaultUnitChange = (defaultUnit: Sheet['defaultUnit']) => {
    this.sheetDefaultUnit = defaultUnit;
    this.recomputeFields();
  };

  fields: Array<Field> = [];
  recomputeFields() {
    const fields = new Map<string, Array<SelectionInspectorFieldOptions | SelectionInspectorFieldRow>>();
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
              console.warn(`Field key=${field.key} type=${field.type} cannot be merged with existing key of type=${existingForKey[0].type}, skipping...`);
              continue;
            }
            fieldFrequencies.set(field.key, (fieldFrequencies.get(field.key) ?? 0) + 1);
            continue;
          }

          // Otherwise, merge fields together
          const match = existingForKey.find((existing) => existing.type === field.type && existing.key === field.key);
          // console.log('MATCH', match);
          if (match) {
            if (!('value' in match)) {
              console.warn(`Field key=${field.key} type=${field.type} cannot be merged into existing matching field type=${match.type}, no "value" attribute found, skipping...`);
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

    console.log('FIELDS:', fieldFrequencies, fieldKeyOrder.map((key) => fields.get(key)!));

    const processed = fieldKeyOrder.flatMap((key) => {
      if (fieldFrequencies.get(key) !== this.selectedIds.length) {
        return [];
      }
      return [this.aggregateFieldValue(fields.get(key)!, key)];
    });
    console.log('PROCESSED:', processed);

    this.fields = processed;
    this.emit('fieldsChange', processed);
  }

  private aggregateRows(
    rows: Array<SelectionInspectorFieldRow>
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
        fields: rows[0].fields.map((f) => ({ type: 'heterogeneous', key: f.key })),
      };
    }

    const fieldCommonKeys = Array.from(
      rows
        .map((row) => new Set(row.fields.map((f) => f.key)))
        .reduce((a, b) => a.intersection(b))
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
            return { type: 'heterogeneous', key };
          }
        }
        // console.log('FIELDS FOR KEYS ACROSS ROWS:', key, fieldsForKeyAcrossRows);
        return this.aggregateFieldValue(fieldsForKeyAcrossRows, key) as Variance<SelectionInspectorField | FieldLabel>;
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
        fields: entries[0].fields.map((f) => ({ type: 'heterogeneous', key: f.key })),
      };
    }

    const fieldCommonKeys = Array.from(
      entries
        .map((row) => new Set(row.fields.map((f) => f.key)))
        .reduce((a, b) => a.intersection(b))
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
            return { type: 'heterogeneous', key };
          }
        }
        // console.log('FIELDS FOR KEYS ACROSS LABELS:', key, fieldsForKeyAcrossLabels);
        return this.aggregateFieldValue(fieldsForKeyAcrossLabels, key) as Variance<SelectionInspectorField>;
      }),
    };
  }

  /** Takes an "options" type, and collapses it into a single value version. Uses either the first
   * entry in the options type as the new value, or if specified, {@link newValue}. */
  private collapseFieldOptions<F extends SelectionInspectorFieldOptions>(
    fieldOptions: F,
    newValue?: Extract<F, { value: unknown }>["value"][0],
  ): SelectionInspectorField {
    switch (fieldOptions.type) {
      case 'read-only':
        return { type: 'read-only', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0] };
      case 'number':
        return { type: 'number', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0] };
      case 'length':
        return { type: 'length', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0], readOnlyUnit: fieldOptions.readOnlyUnit };
      case 'angle':
        return { type: 'angle', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0] };
      case 'render-order':
        return { type: 'render-order', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0] };
      case 'color':
        return { type: 'color', key: fieldOptions.key, value: (newValue as any) ?? fieldOptions.value[0] };
      case 'button':
        return fieldOptions;
    }
  }

  private aggregateFieldValue<F extends SelectionInspectorFieldOptions | SelectionInspectorFieldRow | SelectionInspectorLabelledField>(
    entries: Array<F>,
    key: string,
  ): Field<OptionsToSingle<F>> {
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
        case 'number':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
        case 'length':
          return (acc as typeof e.value).flatMap((value) => {
            return e.value.filter((eValue) => eValue.type === value.type && eValue.magnitude === value.magnitude)
          });
        case 'angle':
          return (acc as typeof e.value).flatMap((value) => {
            return e.value.filter((eValue) => eValue.type === value.type && eValue.magnitude === value.magnitude)
          });
        case 'color':
          return (acc as typeof e.value).filter((value) => e.value.includes(value));
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
      return this.collapseFieldOptions(
        entries[0],
        combined[0],
      ) as Field<OptionsToSingle<F>>; // homogeneous
    } else {
      return { type: 'heterogeneous', key };
    }
  }

  private computeFieldsForComponent(
    entity: Entity,
    Component: NonNullable<ReturnType<typeof getComponentByKey>>,
  ) {
    switch (Component.key) {
      case GeometryComponent.key: {
        if (!Entity.hasComponent(entity, GeometryComponent)) {
          return [];
        }
        const geometryData = GeometryComponent.get<GeometryData>(entity);
        switch (geometryData.type) {
          case 'rectangle':
            return [
              row('position', [
                labelled('x', 'X:', length('x', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.x), { readOnlyUnit: true })),
                labelled('y', 'Y:', length('y', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.y), { readOnlyUnit: true })),
              ]),
              row('dimensions', [
                labelled('width', 'W:', length('width', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.lowerRight.x - geometryData.upperLeft.x), { readOnlyUnit: true })),
                button('link', icon(<LinkIcon size={14} />)),
                labelled('height', 'H:', length('height', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.lowerRight.y - geometryData.upperLeft.y), { readOnlyUnit: true })),
              ]),
              button('convert-to-polygon', 'To polygon...'),
            ];
          case 'ellipse':
            return [
              row('position', [
                labelled('x', 'X:', length('x', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.x), { readOnlyUnit: true })),
                labelled('y', 'Y:', length('y', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.y), { readOnlyUnit: true })),
              ]),
              row('radius', [
                labelled('rx', 'RX:', length('rx', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusX), { readOnlyUnit: true })),
                button('link', icon(<LinkIcon size={14} />)),
                labelled('ry', 'RY:', length('ry', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusY), { readOnlyUnit: true })),
              ]),
              button('convert-to-polygon', 'To polygon...'),
            ];
          case 'polygon':
            // TODO: add this
            return [];
          default:
            geometryData satisfies never;
            return [];
        }
      };
      default:
        return [];
    }
  }
}
