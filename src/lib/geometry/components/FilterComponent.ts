import { Filter, type FilterData } from '../filters';
import { type Geometry, type GeometryComponent } from '../types';

/**
 * Geometry component for a filter.
 */
export type FilterComponent<C extends FilterData = FilterData> = GeometryComponent<
  'filter',
  { data: C; order: number }
>;

export namespace FilterComponent {
  export const key: keyof FilterComponent = 'filter';

  export function create<C extends FilterData>(data: C, order: number = 0): FilterComponent<C> {
    return { filter: { data, order } };
  }

  export function get<C extends FilterData>(geometry: Geometry<FilterComponent<C>>): C;
  export function get(geometry: Filter): FilterData;
  export function get<C extends FilterData>(geometry: Geometry<FilterComponent<C>>): C {
    return geometry.components.filter.data;
  }

  export function update(
    geometry: Geometry<FilterComponent>,
    partial: Partial<FilterData>,
  ): Geometry<FilterComponent> {
    const merged = { ...geometry.components.filter.data, ...partial } as FilterData;
    return {
      ...geometry,
      components: {
        ...geometry.components,
        filter: { ...geometry.components.filter, data: merged },
      },
    };
  }

  export function updateOrder(
    geometry: Geometry<FilterComponent>,
    order: number,
  ): Geometry<FilterComponent> {
    const merged = { ...geometry.components.filter, order };
    return {
      ...geometry,
      components: {
        ...geometry.components,
        filter: merged,
      },
    };
  }
}
