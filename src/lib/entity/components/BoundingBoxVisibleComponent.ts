import { Entity, EntityComponent } from '../types';
import { DatumComponent } from './DatumComponent';

export type BoundingBoxVisibleComponent = EntityComponent<'boundingBoxVisible', never>;

export namespace BoundingBoxVisibleComponent {
  export const key: keyof BoundingBoxVisibleComponent = 'boundingBoxVisible';

  /** Returns false if the geometry is a datum (which has zero area and should not
   *  contribute to a visible selection bounding box), true otherwise. */
  export function get(geometry: Entity): boolean {
    if (Entity.hasComponent(geometry, DatumComponent)) {
      return false;
    }
    return true;
  }
}
