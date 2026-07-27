import { Filter, type FilterData } from '@/lib/entity/filters';
import { ChamferFilter, ChamferFilterData } from '@/lib/entity/filters/chamfer';
import { FilletFilter, FilletFilterData } from '@/lib/entity/filters/fillet';
import { MirrorFilter, MirrorFilterData } from '@/lib/entity/filters/mirror';
import { UndoEntry } from '@/lib/history/types';
import { SheetPosition } from '@/lib/viewport/types';
import { DEFAULT_COLOR } from '../colors';
import { RectangleEndpoint } from '../rectangle';
import { type Entity, type EntityComponent } from '../types';
import { FillColorComponent } from './FillColorComponent';
import { GeometryComponent } from './GeometryComponent';

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
        return MirrorFilter.translate(
          filter as Entity<FilterComponent<MirrorFilterData>>,
          transform,
        );
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

  /** Given a geometry which has been recently moved and all filters associated with that geometry,
   * returns the geometry updated with a FillColorComponent based on whether it should be filled
   * or not.
   *
   * If `originalGeometry` is passed, use this as the "before" geometry state when determining if
   * the geometry needs to be filled. This is useful in contexts like dragging a polygon vertex
   * where a bunch of *Direct updates are made to the geometry state with a final onCommit update
   * which actually emits history events. Without this, the "before" state would be dirty state
   * from the middle of the move, not the actual before state. */
  export function syncFillColor<G extends Entity<GeometryComponent & Partial<FillColorComponent>>>(
    geometry: G,
    filters: Array<Filter>,
    originalGeometry?: G,
  ): [G, Array<UndoEntry>] {
    // Aggregate: determine if ANY mirror filter qualifies for fill, then
    // make a single add/remove decision.  Processing filters one at a time
    // would cause the second filter to undo the first filter's fill change.
    const polyData = GeometryComponent.get(geometry);
    if (polyData.type !== 'polygon' || polyData.closed) {
      return [geometry, []];
    }

    const prev = originalGeometry ?? geometry;
    const hasFill = FillColorComponent.has(prev);

    let shouldFill = false;
    for (const filter of filters) {
      const fd = FilterComponent.get(filter);
      switch (fd.type) {
        case 'mirror':
          const output = MirrorFilter.computeDynamicFillState(geometry, fd);
          if (output === 'filled') {
            shouldFill = true;
          }
          break;
        case 'fillet':
        case 'chamfer':
          break;
        default:
          fd satisfies never;
          break;
      }
    }

    if (shouldFill && !hasFill) {
      const color =
        polyData.type === 'polygon' && typeof polyData.lastFillColor !== 'undefined'
          ? polyData.lastFillColor
          : DEFAULT_COLOR;
      return [
        FillColorComponent.update(geometry, color),
        [UndoEntry.fillColorAdd(geometry.id, color)],
      ];
    } else if (!shouldFill && hasFill) {
      const currentColor = FillColorComponent.get(prev);
      const withLastFill =
        polyData.type === 'polygon'
          ? GeometryComponent.update(geometry, { lastFillColor: currentColor })
          : geometry;
      return [
        FillColorComponent.remove(withLastFill) as G,
        [UndoEntry.fillColorRemove(geometry.id, currentColor)],
      ];
    } else {
      return [geometry, []];
    }
  }
}
