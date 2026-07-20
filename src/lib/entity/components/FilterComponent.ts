import { Filter, type FilterData } from '../filters';
import { RectangleEndpoint } from '../rectangle';
import { type Entity, type EntityComponent } from '../types';

/**
 * Geometry component for a filter.
 */
export type FilterComponent<C extends FilterData = FilterData> = EntityComponent<
  'filter',
  { data: C; order: number }
>;

export namespace FilterComponent {
  export const key: keyof FilterComponent = 'filter';

  export function create<C extends FilterData>(data: C, order: number = 0): FilterComponent<C> {
    return { filter: { data, order } };
  }

  export function get<C extends FilterData>(geometry: Entity<FilterComponent<C>>): C;
  export function get(geometry: Filter): FilterData;
  export function get<C extends FilterData>(geometry: Entity<FilterComponent<C>>): C {
    return geometry.components.filter.data;
  }

  export function update(
    geometry: Entity<FilterComponent>,
    partial: Partial<FilterData>,
  ): Entity<FilterComponent> {
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
    geometry: Entity<FilterComponent>,
    order: number,
  ): Entity<FilterComponent> {
    const merged = { ...geometry.components.filter, order };
    return {
      ...geometry,
      components: {
        ...geometry.components,
        filter: merged,
      },
    };
  }

  export function isLockedToRectangle(
    geometry: Entity<FilterComponent>,
    rectangleId: Entity['id'],
    rectanglePoint: RectangleEndpoint,
  ) {
    const filter = FilterComponent.get(geometry);
    switch (filter.type) {
      case 'fillet':
      case 'chamfer':
        return (
          filter.geometryType === 'rectangle' &&
          filter.geometryId === rectangleId &&
          filter.pointCenterKeyPoint === rectanglePoint
        );
      case 'mirror':
        return false;
      default:
        filter satisfies never;
        return false;
    }
  }

  export function isLockedToPolygon(
    geometry: Entity<FilterComponent>,
    polygonId: Entity['id'],
    pointIndex: number,
  ) {
    const filter = FilterComponent.get(geometry);
    switch (filter.type) {
      case 'fillet':
      case 'chamfer':
        return (
          filter.geometryType === 'polygon' &&
          filter.geometryId === polygonId &&
          filter.pointCenterIndex === pointIndex
        );
      case 'mirror':
        return false;
      default:
        filter satisfies never;
        return false;
    }
  }
}
