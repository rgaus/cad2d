import type { Entity } from '../../types';

/** A component template which can write its data back to an entity. */
export type WritableTemplate<Data, EntityType extends Entity = Entity> = {
  update(entity: EntityType, data: Data): EntityType;
};
