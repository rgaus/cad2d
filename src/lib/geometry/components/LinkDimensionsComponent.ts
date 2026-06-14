import { Geometry, GeometryComponent } from '../types';

/** If true, width and height change together to maintain the original aspect ratio. */
export type LinkDimensionsComponent = GeometryComponent<'linkDimensions', boolean>;

export namespace LinkDimensionsComponent {
  export const key: keyof LinkDimensionsComponent = 'linkDimensions';

  export function create(linkDimensions: boolean): LinkDimensionsComponent {
    return { linkDimensions };
  }
  export function get(geometry: Geometry<LinkDimensionsComponent>): boolean {
    return geometry.components.linkDimensions;
  }
  export function update<G extends Geometry<LinkDimensionsComponent>>(
    geometry: G,
    linkDimensions: boolean,
  ): G {
    return { ...geometry, components: { ...geometry.components, linkDimensions } };
  }
}
