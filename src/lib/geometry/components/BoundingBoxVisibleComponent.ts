import { Geometry, GeometryComponent } from '../types';
import { DatumComponent } from './DatumComponent';

export type BoundingBoxVisibleComponent = GeometryComponent<'boundingBoxVisible', never>;

export namespace BoundingBoxVisibleComponent {
  export const key: keyof BoundingBoxVisibleComponent = 'boundingBoxVisible';

  /** Returns false if the geometry is a datum (which has zero area and should not
   *  contribute to a visible selection bounding box), true otherwise. */
  export function get(geometry: Geometry): boolean {
    if (Geometry.hasComponent(geometry, DatumComponent)) {
      return false;
    }
    return true;
  }
}
