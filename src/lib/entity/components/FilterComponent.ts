import { UndoEntry } from '@/lib/history/types';
import { Filter, type FilterData } from '@/lib/entity/filters';
import { MirrorFilter, MirrorFilterData } from '@/lib/entity/filters/mirror';
import { RectangleEndpoint } from '../rectangle';
import { type Entity, type EntityComponent } from '../types';
import { FillColorComponent } from './FillColorComponent';
import { type GeometryComponent } from './GeometryComponent';
import { SheetPosition } from '@/lib/viewport/types';
import { FilletFilterData, FilletFilter } from '@/lib/entity/filters/fillet';
import { ChamferFilterData, ChamferFilter } from '@/lib/entity/filters/chamfer';

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

  /** Takes a filter and translates all points according to {@link transform}. */
  export function translate(
    filter: Entity<FilterComponent>,
    transform: (point: SheetPosition) => SheetPosition,
  ) {
    const filterData = FilterComponent.get(filter);
    switch (filterData.type) {
      case 'fillet':
      case 'chamfer':
        // These filters are locked to a geometry implicitly, there's no point stored in them
        return filter;
      case 'mirror':
        return MirrorFilter.translate(filter as Entity<FilterComponent<MirrorFilterData>>, transform);
      default:
        filterData satisfies never;
        throw new Error(`Filter.translate: Unknown filter type ${(filterData as any).type}`);
    }
  }

  export function equals(a: Entity<FilterComponent>, b: Entity<FilterComponent>): boolean {
    const filterData = FilterComponent.get(a);
    switch (filterData.type) {
      case 'fillet':
        return FilletFilter.equals(a as Entity<FilterComponent<FilletFilterData>>, b);
      case 'chamfer':
        return ChamferFilter.equals(a as Entity<FilterComponent<ChamferFilterData>>, b);
      case 'mirror':
        return MirrorFilter.equals(a as Entity<FilterComponent<MirrorFilterData>>, b);
      default:
        filterData satisfies never;
        throw new Error(
          `FilterComponent.equals: Unknown filter data type ${(filterData as any).type}`,
        );
    }
  }

  /** Given a geometry which has been recently moved and all fitlers associated with that geometry,
   * returns a the geometry updated with a FillColorComponent based on whether it should be filled
   * or not.
   *
   * If `originalGeometry` is passed, use this as the "before" geometry state when determining if
   * the geoemtry needs to be filled. This is useful in contexts like dragging a polygon vertex
   * where a bunch of *Direct updates are made to the geometry state with a final onCommit update
   * which actually emits history events. Without this, the "before" state would be dirty state
   * from the middle of the move, not the actual before state. */
  export function syncFillColor<G extends Entity<GeometryComponent & Partial<FillColorComponent>>>(
    geometry: G,
    filters: Array<Filter>,
    originalGeometry?: G,
  ): [G, Array<UndoEntry>] {
    let accumulator = geometry;
    const historyEvents: Array<UndoEntry> = [];
    for (const filter of filters) {
      const filterData = FilterComponent.get(filter);
      switch (filterData.type) {
        case 'fillet':
        case 'chamfer':
          break;
        case 'mirror':
          const output = MirrorFilter.syncFillColor(accumulator, filterData, originalGeometry);
          accumulator = output[0];
          if (output[1]) {
            historyEvents.push(output[1]);
          }
          break;
        default:
          filterData satisfies never;
          break;
      }
    }
    return [accumulator, historyEvents] as const;
  }
}
