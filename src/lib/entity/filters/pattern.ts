import { closestPointOnSegment } from '@/lib/math';
import { lineLineIntersection } from '@/lib/math/intersection';
import { Angle } from '@/lib/units/angle';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, type Polygon, PolygonSegment } from '..';
import { DEFAULT_COLOR } from '../colors';
import { FillColorComponent } from '../components/FillColorComponent';
import { FilterComponent } from '../components/FilterComponent';
import { GeometryComponent } from '../components/GeometryComponent';

export type PatternGridFilterData = {
  type: 'pattern';
  mode: 'grid';
  geometryId: Polygon['id'];
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  xRepeats: number;
  yRepeats: number;
};

export type PatternRadialFilterData = {
  type: 'pattern';
  mode: 'radial';
  geometryId: Polygon['id'];
  center: SheetPosition;
  radius: number;
  repeats: { type: 'count'; count: number }; // TODO: Add angle / arc length option?
};

export type PatternFilterData = PatternGridFilterData | PatternRadialFilterData;

export namespace PatternFilter {
  /** Creates a new pattern filter, which takes a rectilinear region and repeats it a defined number
   * of times in the x and y directions. */
  export function createGrid(
    geometryId: Entity['id'],
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: { xRepeats?: number; yRepeats?: number },
  ): PatternGridFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'pattern',
        mode: 'grid',
        geometryId,
        upperLeft,
        lowerRight,
        xRepeats: options?.xRepeats ?? 1,
        yRepeats: options?.yRepeats ?? 1,
      }),
    };
  }

  /** Creates a new pattern filter, which takes a pie shaped region and resolves it around a common
   * center point. */
  export function createRadial(
    geometryId: Entity['id'],
    center: SheetPosition,
    radius: number,
    options?: { count?: number },
  ): PatternRadialFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'pattern',
        mode: 'radial',
        geometryId,
        center,
        radius,
        repeats: { type: 'count', count: options?.count ?? 4 },
      }),
    };
  }

  /** Given a polygon segment path for an open polygon, returns 'left' or 'right' if the polygon
   * segment path touches the specified edge of the pie slice. For a non closed polygon to be
   * patterned, it must have one endpoint on one side and one endpoint on the other side. */
  export function getRadialCornerPoints<
    F extends {
      mode: 'radial';
      center: SheetPosition;
      radius: number;
      repeats: { type: 'count'; count: number };
    },
  >(filterData: F): [SheetPosition, SheetPosition] {
    let angleDegreesOfPieSlice;
    switch (filterData.repeats.type) {
      case 'count':
        angleDegreesOfPieSlice = Angle.degrees(360 / filterData.repeats.count);
        break;
      default:
        filterData.repeats.type satisfies never;
        throw new Error(`Unknown repeats type ${(filterData.repeats as any).type}`);
    }

    const oppositeOverAdjacent = Math.tan(angleDegreesOfPieSlice.toRadians().magnitude / 2);
    const rightSideSlope = 1 / oppositeOverAdjacent;
    const leftSideSlope = -1 * rightSideSlope;

    const topLineIntercept = new SheetPosition(
      filterData.center.x,
      filterData.center.y - filterData.radius,
    );

    const leftResult = lineLineIntersection(
      topLineIntercept,
      0 /* m = 0 */,
      filterData.center,
      leftSideSlope,
    );
    if (leftResult === 'coincident') {
      throw new Error(
        'Left corner point of radial pattern pie slice is coincident, this should be impossible.',
      );
    }
    const leftCornerPoint = leftResult[0];

    const rightResult = lineLineIntersection(
      topLineIntercept,
      0 /* m = 0 */,
      filterData.center,
      rightSideSlope,
    );
    if (rightResult === 'coincident') {
      throw new Error(
        'Right corner point of radial pattern pie slice is coincident, this should be impossible.',
      );
    }
    const rightCornerPoint = rightResult[0];

    return [leftCornerPoint, rightCornerPoint];
  }

  /** Given a polygon segment path for an open polygon, returns which edge of the pie slice the
   * first point lies on: 'left' if the first point is on the left edge and last on the right,
   * 'right' if the first point is on the right edge and last on the left. Returns null if the
   * polygon does not touch both pie slice edges. */
  export function arePolygonEndpointsOnEdgeLine<
    F extends
      | {
          mode: 'grid';
          upperLeft: SheetPosition | null;
          lowerRight: SheetPosition | null;
          xRepeats?: number;
          yRepeats?: number;
        }
      | {
          mode: 'radial';
          center: SheetPosition | null;
          radius: number | null;
          repeats: { type: 'count'; count: number } | null;
        },
  >(filterData: F, points: Array<PolygonSegment>): 'left' | 'right' | null {
    if (points.length < 2) {
      return null;
    }

    switch (filterData.mode) {
      case 'grid': {
        // TODO: add this
        return null;
      }
      case 'radial': {
        if (!filterData.center || !filterData.radius || !filterData.repeats) {
          return null;
        }

        const [leftCornerPoint, rightCornerPoint] = getRadialCornerPoints(filterData as any);

        const firstPoint = points[0].point;
        const lastPoint = points.at(-1)!.point;
        if (
          closestPointOnSegment(filterData.center, leftCornerPoint, firstPoint).distance === 0 &&
          closestPointOnSegment(filterData.center, rightCornerPoint, lastPoint).distance === 0
        ) {
          return 'left';
        }

        if (
          closestPointOnSegment(filterData.center, rightCornerPoint, firstPoint).distance === 0 &&
          closestPointOnSegment(filterData.center, leftCornerPoint, lastPoint).distance === 0
        ) {
          return 'right';
        }

        return null;
      }
    }
  }

  export function translate(
    filter: Entity<FilterComponent<PatternFilterData>>,
    transform: (point: SheetPosition) => SheetPosition,
  ) {
    const filterData = FilterComponent.get(filter);
    switch (filterData.mode) {
      case 'grid':
        return FilterComponent.update(filter, {
          upperLeft: transform(filterData.upperLeft),
          lowerRight: transform(filterData.lowerRight),
        });
      case 'radial':
        return FilterComponent.update(filter, {
          center: transform(filterData.center),
        });
      default:
        filterData satisfies never;
        throw new Error(`Unknown filter type ${(filterData as any).type}`);
    }
  }

  export function equals(
    a: Entity<FilterComponent<PatternFilterData>>,
    b: Entity<FilterComponent>,
  ) {
    const aData = FilterComponent.get(a);
    const bData = FilterComponent.get(b);
    if (bData.type !== 'pattern') {
      return false;
    }
    if (aData.geometryId !== bData.geometryId) {
      return false;
    }

    switch (aData.mode) {
      case 'grid':
        if (bData.mode !== 'grid') {
          return false;
        }
        return (
          aData.upperLeft.x === bData.upperLeft.x &&
          aData.upperLeft.y === bData.upperLeft.y &&
          aData.lowerRight.x === bData.lowerRight.x &&
          aData.lowerRight.y === bData.lowerRight.y &&
          aData.xRepeats === bData.xRepeats &&
          aData.yRepeats === bData.yRepeats
        );
      case 'radial':
        if (bData.mode !== 'radial') {
          return false;
        }
        return (
          aData.center.x === bData.center.x &&
          aData.center.y === bData.center.y &&
          aData.radius === bData.radius &&
          aData.repeats.count === bData.repeats.count
        );
      default:
        aData satisfies never;
        throw new Error(`Unknown filter type ${(aData as any).type}`);
    }
  }

  /**
   * Synchronizes {@link FillColorComponent} on a non-closed polygon based on
   * whether any attached pattern filter has both endpoints on the pattern line.
   *
   * - On add: restores fill color from `lastFillColor` (falls back to
   *   {@link DEFAULT_COLOR}).
   * - On remove: stashes the current fill color into `lastFillColor` before
   *   stripping the component, preserving the color for future re-adds.
   * - No-op for closed polygons (FillColorComponent is managed independently).
   */
  export function computeDynamicFillState(
    geometry: Entity<GeometryComponent>,
    filterData: PatternFilterData,
  ): 'unchanged' | 'filled' {
    const polyData = GeometryComponent.get(geometry);
    if (polyData.type !== 'polygon' || polyData.closed) {
      return 'unchanged';
    }
    if (arePolygonEndpointsOnEdgeLine(filterData, polyData.points) !== null) {
      return 'filled';
    }
    return 'unchanged';
  }
}

export type PatternFilter = Entity<FilterComponent<PatternFilterData>>;

export type PatternGridFilterTemplate = Omit<Entity<FilterComponent<PatternGridFilterData>>, 'id'>;
export type PatternRadialFilterTemplate = Omit<
  Entity<FilterComponent<PatternRadialFilterData>>,
  'id'
>;

export type PatternFilterTemplate = PatternGridFilterTemplate | PatternRadialFilterTemplate;
