import { Entity, EntityComponent } from '../types';

/** If true, width and height change together to maintain the original aspect ratio. */
export type LinkDimensionsComponent = EntityComponent<'linkDimensions', boolean>;

export namespace LinkDimensionsComponent {
  export const key: keyof LinkDimensionsComponent = 'linkDimensions';

  export function create(linkDimensions: boolean): LinkDimensionsComponent {
    return { linkDimensions };
  }
  export function get(geometry: Entity<LinkDimensionsComponent>): boolean {
    return geometry.components.linkDimensions;
  }
  /** Returns the linkDimensions flag if present, or undefined if the component is missing. */
  export function getOptional(geometry: Entity): boolean | undefined {
    if (LinkDimensionsComponent.key in geometry.components) {
      return (geometry.components as LinkDimensionsComponent).linkDimensions;
    }
    return undefined;
  }
  export function update<G extends Entity<LinkDimensionsComponent>>(
    geometry: G,
    linkDimensions: boolean,
  ): G {
    return { ...geometry, components: { ...geometry.components, linkDimensions } };
  }
}
