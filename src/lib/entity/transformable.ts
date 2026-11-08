/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-explicit-any */
import type { UnitType } from '@/lib/units/length';
import type {
  GeometryRelativeSheetPosition,
  KeyPoints,
  OrientedRect,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import type { GeometryStore } from './GeometryStore';
import { TransformableComponent } from './components/TransformableComponent';
import type { RenderShape } from './render-shape';
import type { Entity, Id } from './types';
import type { ResizeParams } from './types';

/** The geometry-like operations generic code needs from a transformable entity. */
export type TransformableAdapter<Data> = {
  get(entity: Entity): Data;
  update(entity: Entity, data: Data): Entity;

  getOrigin(entity: Entity): SheetPosition;
  rawKeyPoints(entity: Entity): KeyPoints<GeometryRelativeSheetPosition, string, string>;
  keyPoints(entity: Entity): KeyPoints<GeometryRelativeSheetPosition, string, string>;
  boundingBox(entity: Entity): Rect<GeometryRelativeSheetPosition>;
  orientedBoundingBox(entity: Entity): OrientedRect<GeometryRelativeSheetPosition>;

  translate?(entity: Entity, transform: (position: SheetPosition) => SheetPosition): Entity;

  resize?(
    entity: Entity,
    params: ResizeParams,
    originalBBox?: OrientedRect<SheetPosition>,
  ): Entity | null;

  getKeyPointPosition?(entity: Entity, keyPoint: string): SheetPosition | null;
  equals(a: Entity, b: Entity): boolean;
  createMoveUndoEntry?(id: Id, before: Data, after: Data): unknown;
  getRenderShapes(entity: Entity, sheetDefaultUnit: UnitType): Array<RenderShape>;
};

const adaptersByName = new Map<string, TransformableAdapter<any>>();

export function registerTransformableAdapter<Data>(
  name: string,
  adapter: TransformableAdapter<Data>,
): void {
  adaptersByName.set(name, adapter);
}

export function getTransformableAdapter(entity: Entity): TransformableAdapter<any> | null {
  const transformable = TransformableComponent.getOptional(entity);
  if (!transformable) {
    return null;
  }
  return adaptersByName.get(transformable.adapter) ?? null;
}

export type TransformableConstraintEndpoint<Type extends string> = {
  type: Type;
  id: Id;
  keyPoint: string;
};

export type ConstraintEndpointKeyPointOption = {
  value: string;
  label: string;
  /** Optional 3x3 anchor-grid slot hint for the constraint inspector. */
  slot?: string;
};

export type ConstraintEndpointAdapter<Type extends string = string> = {
  type: Type;
  label: string;

  create(id: Id, keyPoint: string): TransformableConstraintEndpoint<Type>;
  getEntityId(endpoint: TransformableConstraintEndpoint<Type>): Id;
  getKeyPoint(endpoint: TransformableConstraintEndpoint<Type>): string;
  equals(
    a: TransformableConstraintEndpoint<Type>,
    b: TransformableConstraintEndpoint<Type>,
  ): boolean;

  matches(entity: Entity): boolean;
  listEntities(store: GeometryStore): Array<Entity>;
  keyPointOptions: Array<ConstraintEndpointKeyPointOption>;
  getKeyPointPosition(entity: Entity, keyPoint: string): SheetPosition | null;
  resolve(
    endpoint: TransformableConstraintEndpoint<Type>,
    store: GeometryStore,
  ): SheetPosition | null;

  serializeAttrs(prefix: string, endpoint: TransformableConstraintEndpoint<Type>): Array<string>;
  parseAttrs(
    attrs: Record<string, string | number | undefined>,
    prefix: string,
    getId: (raw: string) => Id,
  ): TransformableConstraintEndpoint<Type>;
};

const constraintEndpointAdaptersByType = new Map<string, ConstraintEndpointAdapter<any>>();

export function registerConstraintEndpointAdapter<Type extends string>(
  adapter: ConstraintEndpointAdapter<Type>,
): void {
  constraintEndpointAdaptersByType.set(adapter.type, adapter);
}

export function getConstraintEndpointAdapterByType(
  type: string,
): ConstraintEndpointAdapter<any> | null {
  return constraintEndpointAdaptersByType.get(type) ?? null;
}

export function getConstraintEndpointAdapter(endpoint: {
  type: string;
}): ConstraintEndpointAdapter<any> | null {
  return getConstraintEndpointAdapterByType(endpoint.type);
}

export function getConstraintEndpointAdapters(): Array<ConstraintEndpointAdapter<any>> {
  return [...constraintEndpointAdaptersByType.values()];
}

export function getConstraintEndpointAdapterForEntity(
  entity: Entity,
): ConstraintEndpointAdapter<any> | null {
  for (const adapter of constraintEndpointAdaptersByType.values()) {
    if (adapter.matches(entity)) {
      return adapter;
    }
  }
  return null;
}

/** Builds a constraint-endpoint adapter for a transformable entity type. */
export function generateConstraintEndpoint<Name extends string>(
  name: Name,
  config: {
    label: string;
    matches: (entity: Entity) => boolean;
    listEntities: (store: GeometryStore) => Array<Entity>;
    keyPointOptions: Array<ConstraintEndpointKeyPointOption>;
  },
): ConstraintEndpointAdapter<`locked-${Name}`> {
  const type = `locked-${name}` as const;

  const adapter: ConstraintEndpointAdapter<`locked-${Name}`> = {
    type,
    label: config.label,

    create: (id, keyPoint) => ({ type, id, keyPoint }),
    getEntityId: (endpoint) => endpoint.id,
    getKeyPoint: (endpoint) => endpoint.keyPoint,
    equals: (a, b) => a.type === b.type && a.id === b.id && a.keyPoint === b.keyPoint,

    matches: config.matches,
    listEntities: config.listEntities,
    keyPointOptions: config.keyPointOptions,

    getKeyPointPosition: (entity, keyPoint) => {
      const adapter = getTransformableAdapter(entity);
      return adapter?.getKeyPointPosition?.(entity, keyPoint) ?? null;
    },

    resolve: (endpoint, store) => {
      const entity = store.getById(endpoint.id);
      if (!entity) {
        return null;
      }
      const adapter = getTransformableAdapter(entity);
      return adapter?.getKeyPointPosition?.(entity, endpoint.keyPoint) ?? null;
    },

    serializeAttrs: (prefix, endpoint) => [
      `data-${prefix}-type="${endpoint.type}"`,
      `data-${prefix}-id="${endpoint.id}"`,
      `data-${prefix}-key-point="${endpoint.keyPoint}"`,
    ],

    parseAttrs: (attrs, prefix, getId) => ({
      type,
      id: getId(`${attrs[`data-${prefix}-id`]}`),
      keyPoint: `${attrs[`data-${prefix}-key-point`]}`,
    }),
  };

  registerConstraintEndpointAdapter(adapter);
  return adapter;
}

export type TransformableUndoEntry<Prefix extends string, Action extends string, Data> = {
  type: `${Prefix}-${Action}`;
  id: Id;
  before: Data;
  after: Data;
};

export type TransformableUndoEntryCreators<Prefix extends string, Data> = {
  move: (id: Id, before: Data, after: Data) => TransformableUndoEntry<Prefix, 'move', Data>;
  update: (id: Id, before: Data, after: Data) => TransformableUndoEntry<Prefix, 'update', Data>;
};

export type TransformableUndoEntrySet<Prefix extends string, Data> = {
  creators: TransformableUndoEntryCreators<Prefix, Data>;
  applyForward: (
    store: GeometryStore,
    entry: TransformableUndoEntry<Prefix, 'move' | 'update', Data>,
  ) => void;
  applyReverse: (
    store: GeometryStore,
    entry: TransformableUndoEntry<Prefix, 'move' | 'update', Data>,
  ) => void;
};

/** Extracts the union of all entry types generated by a transformable undo-entry set. */
export type ListTransformableAdapterUndoEntryCreators<T> = T extends {
  creators: infer Creators;
}
  ? Creators extends Record<string, (...args: any[]) => infer Entry>
    ? Entry
    : never
  : never;

export function generateTransformableUndoEntryEvents<Prefix extends string, Data>(
  prefix: Prefix,
  component: {
    get(entity: Entity): Data;
    update(entity: Entity, data: Data): Entity;
  },
): TransformableUndoEntrySet<Prefix, Data> {
  const makeEntry =
    <Action extends 'move' | 'update'>(action: Action) =>
    (id: Id, before: Data, after: Data) =>
      ({
        type: `${prefix}-${action}`,
        id,
        before,
        after,
      }) as TransformableUndoEntry<Prefix, Action, Data>;

  return {
    creators: {
      move: makeEntry('move'),
      update: makeEntry('update'),
    },
    applyForward: (store, entry) => {
      store.updateByIdDirect(entry.id, (entity) => component.update(entity, entry.after));
    },
    applyReverse: (store, entry) => {
      store.updateByIdDirect(entry.id, (entity) => component.update(entity, entry.before));
    },
  };
}

/** Helper namespace matching the `TransformableAdapter.history.*` API shape. */
export namespace TransformableAdapter {
  export const history = {
    generateUndoEntryEvents: generateTransformableUndoEntryEvents,
  };

  export const constraints = {
    generateConstraintEndpoint,
  };
}
