import { Geometry, GeometryComponent, GeometryOmitComponents } from '../types';

/** Fill color as a 24-bit integer (0xRRGGBB), or null for no fill. */
export type FillColorComponent = GeometryComponent<'fillColor', number | null>;

export namespace FillColorComponent {
  export const key: keyof FillColorComponent = 'fillColor';

  export function create(fillColor: number | null): FillColorComponent {
    return { fillColor };
  }

  /** Get the value of the {@link FillColorComponent} from a given {@link Geometry}. */
  export function get(geometry: Geometry<FillColorComponent>): number | null {
    return geometry.components.fillColor;
  }
  /** Get the value of the {@link FillColorComponent} from a given {@link Geometry} which may or may not have that component. Returns undefined if the component is missing. */
  export function getOptional(geometry: Geometry): number | null | undefined {
    if (Geometry.hasComponent(geometry, FillColorComponent)) {
      return geometry.components.fillColor;
    } else {
      return undefined;
    }
  }
  export function has(geometry: Geometry): geometry is Geometry<FillColorComponent> {
    return 'fillColor' in Geometry;
  }
  /** Update the given value of the {@link FillColorComponent} for a given {@link Geometry}. */
  export function update<G extends Geometry<FillColorComponent>>(
    geometry: G,
    fillColor: number | null,
  ): G {
    return {
      ...geometry,
      components: { ...geometry.components, fillColor },
    };
  }
  /** Remove a given {@link FillColorComponent} from a given {@link Geometry}. */
  export function remove<G extends Geometry<FillColorComponent>>(
    geometry: G,
  ): GeometryOmitComponents<G, FillColorComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.fillColor;
    return { ...geometry, components };
  }
}
