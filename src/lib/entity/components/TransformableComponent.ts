import { registerComponent } from '../registry';
/* eslint-disable @typescript-eslint/no-namespace */
import { Entity, EntityComponent } from '../types';

/** Names the component registry key for the transformable implementation. */
export type TransformableData = {
  component: string;
  translate?: boolean;
  rotate?: boolean;
  scale?: boolean;
};

/** Opts an entity into select-tool movement/rotation/scaling via a registered component. */
export type TransformableComponent = EntityComponent<'transformable', TransformableData>;

export namespace TransformableComponent {
  export const key: keyof TransformableComponent = 'transformable';

  export function create(data: TransformableData): TransformableComponent {
    return { transformable: data };
  }

  export function get(entity: Entity<TransformableComponent>): TransformableData {
    return entity.components.transformable;
  }

  export function getOptional(entity: Entity): TransformableData | null {
    if (TransformableComponent.key in entity.components) {
      return (entity.components as unknown as TransformableComponent).transformable;
    }
    return null;
  }

  export function update<E extends Entity<TransformableComponent>>(
    entity: E,
    data: TransformableData,
  ): E {
    return { ...entity, components: { ...entity.components, transformable: data } };
  }
}

registerComponent(TransformableComponent);
