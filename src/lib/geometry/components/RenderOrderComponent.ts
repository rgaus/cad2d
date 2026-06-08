import { Geometry, GeometryComponent, GeometryOmitComponents } from '../types';

/** Controls rendering order. Higher values render on top of lower values. */
export type RenderOrderComponent = GeometryComponent<'renderOrder', number>;

export namespace RenderOrderComponent {
  export const key: keyof RenderOrderComponent = 'renderOrder';

  export function create(renderOrder: number): RenderOrderComponent {
    return { renderOrder };
  }
  export function get(geometry: Geometry<RenderOrderComponent>): number {
    return geometry.components.renderOrder;
  }
  export function update<G extends Geometry<RenderOrderComponent>>(
    geometry: G,
    renderOrder: number,
  ): G {
    return { ...geometry, components: { ...geometry.components, renderOrder } };
  }
  /** Remove a given {@link RenderOrderComponent} from a given {@link Geometry}. */
  export function remove<G extends Geometry<RenderOrderComponent>>(
    geometry: G,
  ): GeometryOmitComponents<G, RenderOrderComponent> {
    const components: Partial<G['components']> = { ...geometry.components };
    delete components.renderOrder;
    return { ...geometry, components };
  }
}
