import { Entity, EntityComponent, EntityOmitComponents } from '../types';

/** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
export type FillColorComponent = EntityComponent<'fillColor', number | null>;

export namespace FillColorComponent {
  export const key: keyof FillColorComponent = 'fillColor';

  export function create(fillColor: number | null): FillColorComponent {
    return { fillColor };
  }

  /** Get the value of the {@link FillColorComponent} from a given {@link Entity}. */
  export function get(geometry: Entity<FillColorComponent>): number | null {
    return geometry.components.fillColor;
  }
  /** Get the value of the {@link FillColorComponent} from a given {@link Entity} which may or may not have that component. Returns undefined if the component is missing. */
  export function getOptional(geometry: Entity): number | null | undefined {
    if (Entity.hasComponent(geometry, FillColorComponent)) {
      return geometry.components.fillColor;
    } else {
      return undefined;
    }
  }
  export function has(geometry: Entity): geometry is Entity<FillColorComponent> {
    return 'fillColor' in Entity;
  }
  /** Update the given value of the {@link FillColorComponent} for a given {@link Entity}. */
  export function update<G extends Entity<Partial<FillColorComponent>>>(
    geometry: G,
    fillColor: number | null,
  ): G {
    return {
      ...geometry,
      components: { ...geometry.components, fillColor },
    };
  }
  /** Remove a given {@link FillColorComponent} from a given {@link Entity}. */
  export function remove<G extends Entity<Partial<FillColorComponent>>>(
    geometry: G,
  ): EntityOmitComponents<G, FillColorComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.fillColor;
    return { ...geometry, components };
  }
}
