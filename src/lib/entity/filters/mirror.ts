import { UndoEntry } from '@/lib/history/types';
import { closestPointOnSegment } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, type Polygon, PolygonSegment } from '..';
import { GeometryStore } from '../GeometryStore';
import { DEFAULT_COLOR } from '../colors';
import { FillColorComponent } from '../components/FillColorComponent';
import { FilterComponent } from '../components/FilterComponent';
import { GeometryComponent } from '../components/GeometryComponent';
import { PolygonData } from '../geometry/polygon';
import type { Id } from '../types';

export type MirrorFilterData = {
  type: 'mirror';
  geometryId: Polygon['id'];
  pointA: SheetPosition;
  pointB: SheetPosition;
};

export namespace MirrorFilter {
  /** Creates a new mirror filter associated with a single geoemtry and a line made up of pointA/pointB . */
  export function create(
    geometryId: Entity['id'],
    pointA: SheetPosition,
    pointB: SheetPosition,
  ): MirrorFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'mirror',
        geometryId,
        pointA,
        pointB,
      }),
    };
  }

  /** Given a polygon segment path for an open polygon, returns true if the polygon segment path
   * should be mirrored across the line due to the points touching the mirror line directly. */
  export function arePolygonEndpointsOnMirrorLine<
    F extends {
      pointA: SheetPosition | null;
      pointB: SheetPosition | null;
    },
  >(filterData: F, points: Array<PolygonSegment>): boolean {
    if (points.length < 2 || !filterData.pointA || !filterData.pointB) {
      return false;
    }

    const firstPoint = points[0].point;
    const firstPointResult = closestPointOnSegment(
      filterData.pointA,
      filterData.pointB,
      firstPoint,
    );
    const firstPointOnMirrorLine = firstPointResult.distance === 0;

    if (!firstPointOnMirrorLine) {
      return false;
    }

    const lastPoint = points.at(-1)!.point;
    const lastPointResult = closestPointOnSegment(filterData.pointA, filterData.pointB, lastPoint);
    const lastPointOnMirrorLine = lastPointResult.distance === 0;

    if (!lastPointOnMirrorLine) {
      return false;
    }

    return true;
  }

  /**
   * Synchronizes {@link FillColorComponent} on a non-closed polygon based on
   * whether any attached mirror filter has both endpoints on the mirror line.
   *
   * - On add: restores fill color from `lastFillColor` (falls back to
   *   {@link DEFAULT_COLOR}).
   * - On remove: stashes the current fill color into `lastFillColor` before
   *   stripping the component, preserving the color for future re-adds.
   * - No-op for closed polygons (FillColorComponent is managed independently).
   */
  export function syncFillColor<G extends Entity<GeometryComponent & Partial<FillColorComponent>>>(
    geometry: G,
    filterData: MirrorFilterData,
    originalGeometry?: G,
  ): [G, UndoEntry | null] {
    const polyData = GeometryComponent.get(geometry);
    if (polyData.type !== 'polygon' || polyData.closed) {
      return [geometry, null];
    }

    const shouldFill =
      filterData.type === 'mirror' &&
      filterData.geometryId === geometry.id &&
      arePolygonEndpointsOnMirrorLine(filterData, polyData.points);

    const prev = originalGeometry ?? geometry;
    const hasFill = FillColorComponent.has(prev);

    if (shouldFill && !hasFill) {
      const color =
        typeof polyData.lastFillColor !== 'undefined' ? polyData.lastFillColor : DEFAULT_COLOR;
      return [
        FillColorComponent.update(geometry, color),
        UndoEntry.fillColorAdd(geometry.id, color),
      ] as const;
    } else if (!shouldFill && hasFill) {
      const currentColor = FillColorComponent.get(prev);
      const withLastFill = GeometryComponent.update(geometry, {
        lastFillColor: currentColor,
      });
      return [
        FillColorComponent.remove(withLastFill) as G,
        UndoEntry.fillColorRemove(geometry.id, currentColor),
      ] as const;
    } else {
      return [geometry, null];
    }
  }
}

export type MirrorFilter = Entity<FilterComponent<MirrorFilterData>>;

export type MirrorFilterTemplate = Omit<Entity<FilterComponent<MirrorFilterData>>, 'id'>;
