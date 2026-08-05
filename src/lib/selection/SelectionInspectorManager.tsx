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
  | { type: 'read-only'; key: string, value: Array<string> }
  | { type: 'number'; key: string; value: Array<number> }
  | { type: 'length'; key: string; value: Array<Length> }
  | { type: 'angle'; key: string; value: Array<Angle> }
  | { type: 'render-order'; value: Array<number>, key: string }
  | { type: 'color'; key: string; value: Array<number | null> }
  | { type: 'button'; label: string | SelectionInspectorIcon, key: string };

function readOnly(key: string, text: string ): SelectionInspectorField {
  return { type: 'read-only', key, value: [text] };
}

function number(key: string, value: number): SelectionInspectorField {
  return { type: 'number', key, value: [value] };
}

function length(key: string, value: Length): SelectionInspectorField {
  return { type: 'length', key, value: [value] };
}

function angle(key: string, value: Angle): SelectionInspectorField {
  return { type: 'angle', key, value: [value] }
}

function renderOrder(key: string, renderOrder: number): SelectionInspectorField {
  return { type: 'render-order', key, value: [renderOrder] };
}

function color(key: string, color: number | null): SelectionInspectorField {
  return { type: 'color', key, value: [color] };
}

function button(key: string, label: string | SelectionInspectorIcon): SelectionInspectorField {
  return { type: 'button', key, label }
}

export type SelectionInspectorLabelledField = Label<SelectionInspectorField>;

function labelled(key: string, label: string, fields: SelectionInspectorField | Array<SelectionInspectorField>): SelectionInspectorLabelledField {
  return { type: 'label', key, label, fields: Array.isArray(fields) ? fields : [fields] };
}

export type SelectionInspectorFieldRow = Row<SelectionInspectorLabelledField | SelectionInspectorField>;

function row(
  key: string,
  fields: Array<SelectionInspectorLabelledField | SelectionInspectorField>
): SelectionInspectorFieldRow {
  return { type: 'row', key, fields };
}

type Variance<T extends { type: string }> = { type: 'heterogeneous' } | T;

type Row<T> = { type: 'row'; key: string; fields: Array<T> };

type Label<T> = { type: 'label'; key: string; label: string; fields: Array<T> };

export type FieldRow = Row<Variance<SelectionInspectorLabelledField | SelectionInspectorField>>;
export type FieldLabel = Label<Variance<SelectionInspectorField>>;

export type Field<F extends { type: string } = SelectionInspectorField | SelectionInspectorFieldRow> =
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
    const fields = new Map<string, Array<SelectionInspectorField | SelectionInspectorFieldRow>>();
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
            fields.set(field.key, [field]);
            continue;
          }

          // Rows should be pushed twice
          if (field.type === 'row') {
            existingForKey.push(field);
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
            }
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
            match.value = [...match.value, ...(field.value as any)];
          }
        }
      }
    }

    // Step 2: Determine which fields all contain a single homogeneous value, or many heterogeneous
    // TODO

    console.log('FIELDS:', fieldKeyOrder.map((key) => fields.get(key)!));

    const processed = fieldKeyOrder.map((key) => this.aggregateFieldValue(fields.get(key)!));
    console.log('PROCESSED:', processed);

    this.fields = processed;
    this.emit('fieldsChange', processed);
  }

  private aggregateRows(
    rows: Array<SelectionInspectorFieldRow>
  ): Row<Variance<SelectionInspectorField | SelectionInspectorLabelledField>> {
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
        fields: rows[0].fields.map(() => ({ type: 'heterogeneous' })),
      };
    }

    const fieldCommonKeys = Array.from(
      rows
        .map((row) => new Set(row.fields.map((f) => f.key)))
        .reduce((a, b) => a.intersection(b))
    );
    const output = {
      type: 'row' as const,
      key: rows[0].key,
      fields: fieldCommonKeys.map((key) => {
        const fieldsForKeyAcrossRows = [];
        for (const row of rows) {
          const match = row.fields.find((f) => f.key === key);
          if (match) {
            fieldsForKeyAcrossRows.push(match);
          } else {
            return { type: 'heterogeneous' as const };
          }
        }
        // console.log('FIELDS FOR KEYS ACROSS ROWS:', key, fieldsForKeyAcrossRows);
        return this.aggregateFieldValue(fieldsForKeyAcrossRows) as Variance<SelectionInspectorField | SelectionInspectorLabelledField>;
      }),
    };
    return output;
  }

  private aggregateLabels(entries: Array<SelectionInspectorLabelledField>): {
    type: 'label';
    key: string;
    label: string;
    fields: Array<Variance<SelectionInspectorField>>;
  } {
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
        fields: entries[0].fields.map(() => ({ type: 'heterogeneous' })),
      };
    }

    const fieldCommonKeys = Array.from(
      entries
        .map((row) => new Set(row.fields.map((f) => f.key)))
        .reduce((a, b) => a.intersection(b))
    );
    const output = {
      type: 'label' as const,
      key: entries[0].key,
      label: entries[0].label,
      fields: fieldCommonKeys.map((key) => {
        const fieldsForKeyAcrossLabels = [];
        for (const label of entries) {
          const match = label.fields.find((f) => f.key === key);
          if (match) {
            fieldsForKeyAcrossLabels.push(match);
          } else {
            return { type: 'heterogeneous' as const };
          }
        }
        // console.log('FIELDS FOR KEYS ACROSS LABELS:', key, fieldsForKeyAcrossLabels);
        return this.aggregateFieldValue(fieldsForKeyAcrossLabels) as Variance<SelectionInspectorField>;
      }),
    };
    return output;
  }

  private aggregateFieldValue<F extends SelectionInspectorField | SelectionInspectorFieldRow | SelectionInspectorLabelledField>(
    entries: Array<F>,
  ): Field<F> {
    // console.log('AGGR', entries);
    if (entries.length === 0) {
      return { type: 'heterogeneous' };
    } else if (entries.length === 1) {
      if (entries[0].type === 'row') {
        return this.aggregateRows([entries[0]]);
      }
      if (entries[0].type === 'label') {
        return this.aggregateLabels([entries[0]]);
      }
      return entries[0]; // homogeneous
    }
    
    const first = entries[0];
    if (!entries.every((e) => e.type === first.type)) {
      return { type: 'heterogeneous' };
    }

    // No 'value' key = use first entry
    if (!('value' in first)) {
      if (first.type === 'row') {
        return this.aggregateRows(entries as Array<SelectionInspectorFieldRow>);
      }
      if (first.type === 'label') {
        return this.aggregateLabels(entries as Array<SelectionInspectorLabelledField>);
      }
      return entries[0]; // homogeneous
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
    }, first.value);

    // console.log('COMBINED', combined);
    if (combined.length === 1) {
      return combined[0] as unknown as F; // homogeneous
    } else {
      return { type: 'heterogeneous' };
    }
  }

  computeFieldsForComponent(
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
                labelled('x', 'X:', length('x', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.x))),
                labelled('y', 'Y:', length('y', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.upperLeft.y))),
              ]),
              row('dimensions', [
                labelled('width', 'W:', length('width', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.lowerRight.x - geometryData.upperLeft.x))),
                button('link', icon(<LinkIcon size={14} />)),
                labelled('height', 'H:', length('height', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.lowerRight.y - geometryData.upperLeft.y))),
              ]),
              button('convert-to-polygon', 'To polygon...'),
            ];
          case 'ellipse':
            return [
              row('position', [
                labelled('x', 'X:', length('x', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.x))),
                labelled('y', 'Y:', length('y', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.center.y))),
              ]),
              row('radius', [
                labelled('rx', 'RX:', length('rx', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusX))),
                button('link', icon(<LinkIcon size={14} />)),
                labelled('ry', 'RY:', length('ry', Length.fromSheetUnits(this.sheetDefaultUnit, geometryData.radiusY))),
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
