import type { Entity } from '../../types';

/** A component template which can read its data from an entity. */
export type ReadableTemplate<Data, EntityType extends Entity = Entity> = {
  get(entity: EntityType): Data;
};
