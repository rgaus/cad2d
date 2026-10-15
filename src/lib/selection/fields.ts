import type { ReactNode } from 'react';
import type { ConstraintEndpoint, Entity } from '@/lib/entity';
import type { PolygonData } from '@/lib/entity/geometry/polygon';
import type { Angle } from '@/lib/units/angle';
import type { Length } from '@/lib/units/length';

/**
 * Event handlers that can be attached to a {@link FieldLeaf}. Every handler is optional; the
 * renderer only wires up the handlers that are present.
 */
export type FieldHandlers<Value> = {
  /** Invoked on click (buttons, link toggles). */
  onClick?: () => void;
  /** Invoked whenever the field value changes. */
  onChange?: (newValue: Value) => void;
  /** Invoked when the field gains focus. */
  onFocus?: () => void;
  /** Invoked when the field loses focus. */
  onBlur?: () => void;
  /** Invoked on keydown, with the raw key name (eg. `"Escape"`). */
  onKeyDown?: (key: string) => void;
};

/** Handlers for the {@link FieldLeaf} `entity-selector` variant. */
export type EntitySelectorHandlers = {
  /** Begins an interactive pick session (hover highlights a geometry, click selects it) */
  onClick?: () => void;
  /** Clears the current value, if possible. */
  onClear?: () => void;
  /** Cancels an interactive pick session. */
  onCancel?: () => void;
  /** Invoked with the picked entity if once a geometry is clicked. */
  onSelect?: (id: Entity['id']) => void;
};

/** Handlers for the {@link FieldLeaf} `polygon-points` variant. Superset of the handlers used by the
 * inline point editor rendered inside the selection inspector. */
export type PolygonPointsHandlers = {
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
  onPointTypeChange?: (index: number, type: PolygonSegmentType) => void;
  onPointMouseEnter?: (index: number) => void;
  onPointMouseLeave?: (index: number) => void;
  onOpenAtIndexMouseEnter?: () => void;
  onOpenAtIndexMouseLeave?: () => void;
  onOpenAtIndexMouseDown?: () => void;
  onCloseOpen?: () => void;
  onCloseOpenMouseEnter?: () => void;
  onCloseOpenMouseLeave?: () => void;
};

type PolygonSegmentType = PolygonData['points'][number]['type'];

/** A non-textual field label (rendered as an inline icon instead of a string). */
export type FieldIcon = { type: 'icon'; icon: ReactNode };

/**
 * A fully-resolved, single-value field — the leaf node actually rendered by the selection
 * inspector. Component field builders produce the plural {@link FieldOptions} form, which the
 * {@link SelectionInspectorManager} collapses down to this single-value form after merging across
 * a multi-selection.
 */
export type FieldLeaf =
  | { type: 'read-only'; key: string; value: string; handlers: FieldHandlers<string> }
  | {
      type: 'spacing';
      key: string;
      width: 'xs' | 'sm' | 'default' | 'lg';
      handlers: FieldHandlers<void>;
    }
  | { type: 'number'; key: string; value: string; handlers: FieldHandlers<string> }
  | {
      type: 'length';
      key: string;
      value: Length;
      readOnlyUnit: boolean;
      handlers: FieldHandlers<Length>;
    }
  | { type: 'angle'; key: string; value: Angle; handlers: FieldHandlers<Angle> }
  | {
      type: 'render-order';
      value: number;
      geometryId?: Entity['id'];
      key: string;
      handlers: FieldHandlers<number>;
    }
  | { type: 'color'; key: string; value: number | null; handlers: FieldHandlers<number | null> }
  | { type: 'link-dimensions-button'; key: string; value: boolean; handlers: FieldHandlers<void> }
  | { type: 'button'; label: string | FieldIcon; key: string; handlers: FieldHandlers<void> }
  | {
      type: 'polygon-points';
      key: string;
      value: PolygonData;
      isPolygonFilledDueToFilter: boolean;
      handlers: PolygonPointsHandlers;
    }
  | {
      type: 'constraint-endpoint';
      key: string;
      label: string;
      value: ConstraintEndpoint;
      handlers: FieldHandlers<ConstraintEndpoint>;
    }
  | {
      type: 'choices';
      key: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      handlers: FieldHandlers<string>;
    }
  | {
      type: 'entity-selector';
      key: string;
      value: Entity['id'] | null;
      clearable: boolean;
      /** Whether an interactive pick session is active for this field. */
      isPicking: boolean;
      handlers: EntitySelectorHandlers;
    };

/**
 * The plural, pre-aggregation counterpart to {@link FieldLeaf}. Each leaf carried a list of values
 * (one per selected entity) so the manager can diff / merge them into a single {@link FieldLeaf}.
 * This is what component field builders produce.
 */
export type FieldOptions =
  | { type: 'read-only'; key: string; value: Array<string>; handlers: Array<FieldHandlers<string>> }
  | {
      type: 'spacing';
      key: string;
      width: 'xs' | 'sm' | 'default' | 'lg';
      handlers: Array<FieldHandlers<void>>;
    }
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
      geometryId: Array<Entity['id']>;
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
      label: string | FieldIcon;
      key: string;
      handlers: Array<FieldHandlers<void>>;
    }
  | {
      type: 'polygon-points';
      key: string;
      value: Array<PolygonData>;
      isPolygonFilledDueToFilter: boolean;
      handlers: Array<PolygonPointsHandlers>;
    }
  | {
      type: 'constraint-endpoint';
      key: string;
      label: string;
      value: Array<ConstraintEndpoint>;
      handlers: Array<FieldHandlers<ConstraintEndpoint>>;
    }
  | {
      type: 'choices';
      key: string;
      value: Array<string>;
      options: Array<{ value: string; label: string }>;
      handlers: Array<FieldHandlers<string>>;
    }
  | {
      type: 'entity-selector';
      key: string;
      value: Array<Entity['id'] | null>;
      clearable: boolean;
      handlers: Array<EntitySelectorHandlers>;
    };

/** A labelled group of {@link FieldOptions}, produced by {@link Fields.labelled}. */
export type FieldOptionsLabel = Label<FieldOptions>;

/** A row of labelled fields / field options, produced by {@link Fields.row}. */
export type FieldOptionsRow = Row<FieldOptionsLabel | FieldOptions>;

/**
 * The complete list of options a single component contributes for a single entity. This is the
 * return type of every `computeSelectionInspectorFields` implementation.
 */
export type FieldOptionsList = Array<FieldOptions | FieldOptionsRow | FieldOptionsLabel>;

/**
 * A heterogeneous placeholder — emitted by the manager when the selected entities disagree on a
 * field's value (or on the set of fields present), so no single value can be shown. The optional
 * `fieldType` records what type of field the values were.
 */
export type Variance<T extends { type: string }> =
  | {
      type: 'heterogeneous';
      key: string;
      fieldType?: FieldOptionsRow['fields'][0]['type'];
    }
  | T;

/** A horizontal row of fields. */
export type Row<T> = { type: 'row'; key: string; fields: Array<T> };

/** A labelled group of fields. */
export type Label<T> = { type: 'label'; key: string; label: string; fields: Array<T> };

/** A fully-aggregated row, as returned by the manager and rendered by the selection inspector. */
export type FieldRow = Row<Variance<FieldLabel | FieldLeaf>>;

/** A fully-aggregated label, as returned by the manager and rendered by the selection inspector. */
export type FieldLabel = Label<Variance<FieldLeaf>>;

/**
 * Maps a pre-aggregation type (whose leaves carry lists of values) to its post-aggregation
 * counterpart (whose leaves carry a single value).
 */
export type OptionsToSingle<F extends FieldOptions | FieldOptionsRow | FieldOptionsLabel> =
  F extends FieldOptions
    ? FieldLeaf
    : F extends FieldOptionsRow
      ? FieldRow
      : F extends FieldOptionsLabel
        ? FieldLabel
        : F;

/** The top-level node type emitted by the manager to the selection inspector renderer. */
export type Field<F extends { type: string } = FieldLeaf | FieldRow> =
  | Variance<F>
  | FieldRow
  | FieldLabel;

/** The value stored for a field while it is being edited (before it is committed to history). */
export type WorkingValue =
  | { type: 'number'; value: string }
  | { type: 'length'; value: Length }
  | { type: 'angle'; value: Angle }
  | { type: 'render-order'; value: number }
  | { type: 'color'; value: number | null }
  | { type: 'link-dimensions-button'; value: boolean }
  | { type: 'entity'; value: Entity['id'] | null };

/** Map from field key to the in-progress value being edited. */
export type WorkingFieldData = Map<string, WorkingValue>;

/** The current state of the "open at index" line which can be dragged to set a polygon's
 * open/close index. */
export type OpenAtIndexState =
  | 'idle' // Not dragging
  | 'dragging'
  | 'highlighted';

/**
 * Constructors for every {@link FieldOptions} variant (plus the structural helpers {@link
 * Fields.labelled} / {@link Fields.row}). Downstream components build their selection inspector
 * fields using these helpers so the wire format stays centralized here.
 */
export namespace Fields {
  /** Build a read-only text field. */
  export function readOnly(
    key: string,
    text: string,
    handlers?: FieldHandlers<string>,
  ): FieldOptions {
    return { type: 'read-only', key, value: [text], handlers: [handlers ?? {}] };
  }

  /** Build a horizontal spacer which is square and of the provided form control size. */
  export function spacing(
    key: string,
    width: 'xs' | 'sm' | 'default' | 'lg',
    handlers?: FieldHandlers<void>,
  ): FieldOptions {
    return { type: 'spacing', key, width, handlers: [handlers ?? {}] };
  }

  /** Build a numeric text-input field. */
  export function number(
    key: string,
    value: number,
    handlers?: FieldHandlers<string>,
  ): FieldOptions {
    return { type: 'number', key, value: [`${value}`], handlers: [handlers ?? {}] };
  }

  /** Build a length field. When `readOnlyUnit` is set, the unit picker is disabled. */
  export function length(
    key: string,
    value: Length,
    options?: { readOnlyUnit?: boolean },
    handlers?: FieldHandlers<Length>,
  ): FieldOptions {
    return {
      type: 'length',
      key,
      value: [value],
      readOnlyUnit: options?.readOnlyUnit ?? false,
      handlers: [handlers ?? {}],
    };
  }

  /** Build an angle field. */
  export function angle(key: string, value: Angle, handlers?: FieldHandlers<Angle>): FieldOptions {
    return { type: 'angle', key, value: [value], handlers: [handlers ?? {}] };
  }

  /** Build a render-order slider field. `geometryId` enables the context thumbnail on the slider. */
  export function renderOrder(
    key: string,
    renderOrder: number,
    geometryId?: Entity['id'],
    handlers?: FieldHandlers<number>,
  ): FieldOptions {
    return {
      type: 'render-order',
      key,
      value: [renderOrder],
      geometryId: typeof geometryId !== 'undefined' ? [geometryId] : [],
      handlers: [handlers ?? {}],
    };
  }

  /** Build a color picker field. */
  export function color(
    key: string,
    color: number | null,
    handlers?: FieldHandlers<number | null>,
  ): FieldOptions {
    return { type: 'color', key, value: [color], handlers: [handlers ?? {}] };
  }

  /** Build the link-dimensions toggle button. */
  export function linkDimensionsButton(
    key: string,
    value: boolean,
    handlers?: FieldHandlers<void>,
  ): FieldOptions {
    return { type: 'link-dimensions-button', key, value: [value], handlers: [handlers ?? {}] };
  }

  /** Build a labelled action button. */
  export function button(
    key: string,
    label: string | FieldIcon,
    handlers?: FieldHandlers<void>,
  ): FieldOptions {
    return { type: 'button', key, label, handlers: [handlers ?? {}] };
  }

  /** Build the inline polygon point editor field. */
  export function polygonPoints(
    key: string,
    value: PolygonData,
    isPolygonFilledDueToFilter: boolean,
    handlers?: PolygonPointsHandlers,
  ): FieldOptions {
    return {
      type: 'polygon-points',
      key,
      value: [value],
      isPolygonFilledDueToFilter,
      handlers: [handlers ?? {}],
    };
  }

  /** Build a constraint-endpoint picker field. */
  export function constraintEndpoint(
    key: string,
    label: string,
    value: ConstraintEndpoint,
    handlers?: FieldHandlers<ConstraintEndpoint>,
  ): FieldOptions {
    return { type: 'constraint-endpoint', key, label, value: [value], handlers: [handlers ?? {}] };
  }

  /** Build a single-select toggle group. */
  export function choices(
    key: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    handlers?: FieldHandlers<string>,
  ): FieldOptions {
    return { type: 'choices', key, value: [value], options, handlers: [handlers ?? {}] };
  }

  /** Build a constraint-endpoint picker field. */
  export function entity(
    key: string,
    value: Entity['id'] | null,
    options?: { clearable?: boolean },
    handlers?: EntitySelectorHandlers,
  ): FieldOptions {
    return {
      type: 'entity-selector',
      key,
      value: [value],
      clearable: options?.clearable ?? false,
      handlers: [handlers ?? {}],
    };
  }

  /** Wrap field(s) under a text label. */
  export function labelled(
    key: string,
    label: string,
    fields: FieldOptions | Array<FieldOptions>,
  ): FieldOptionsLabel {
    return { type: 'label', key, label, fields: Array.isArray(fields) ? fields : [fields] };
  }

  /** Group fields into a horizontal row. */
  export function row(
    key: string,
    fields: Array<FieldOptionsLabel | FieldOptions>,
  ): FieldOptionsRow {
    return { type: 'row', key, fields };
  }

  /** Build an icon-valued label for a button. */
  export function icon(icon: ReactNode): FieldIcon {
    return { type: 'icon', icon };
  }
}
