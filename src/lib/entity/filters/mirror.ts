import { BoundingBox, closestPointOnSegment } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { Entity, type Polygon, PolygonSegment } from '..';
import { DEFAULT_COLOR } from '../colors';
import { FillColorComponent } from '../components/FillColorComponent';
import { FilterComponent } from '../components/FilterComponent';
import {
  GeometryComponent,
  GetRenderShapesOptions,
  RenderShape,
} from '../components/GeometryComponent';

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
   * Serializes mirror filter data to a JSON-safe object for storage in the
   * cad2d-state SVG comment.
   */
  export function toJson(data: MirrorFilterData) {
    return {
      type: 'mirror' as const,
      geometryId: data.geometryId,
      pointA: { x: data.pointA.x, y: data.pointA.y },
      pointB: { x: data.pointB.x, y: data.pointB.y },
    };
  }

  /**
   * Deserializes a mirror filter data object from JSON (as stored in the
   * cad2d-state comment).
   */
  export function fromJson(json: Record<string, unknown>): MirrorFilterData {
    const pointA = json.pointA as { x: number; y: number };
    const pointB = json.pointB as { x: number; y: number };
    return {
      type: 'mirror',
      geometryId: json.geometryId as string,
      pointA: new SheetPosition(pointA.x, pointA.y),
      pointB: new SheetPosition(pointB.x, pointB.y),
    };
  }

  export function translate(
    filter: Entity<FilterComponent<MirrorFilterData>>,
    transform: (point: SheetPosition) => SheetPosition,
  ) {
    const filterData = FilterComponent.get(filter);
    return FilterComponent.update(filter, {
      pointA: transform(filterData.pointA),
      pointB: transform(filterData.pointB),
    });
  }

  export function equals(a: Entity<FilterComponent<MirrorFilterData>>, b: Entity<FilterComponent>) {
    const aData = FilterComponent.get(a);
    const bData = FilterComponent.get(b);
    if (bData.type !== 'mirror') {
      return false;
    }
    return (
      aData.geometryId === bData.geometryId &&
      aData.pointA.x === bData.pointA.x &&
      aData.pointA.y === bData.pointA.y &&
      aData.pointB.x === bData.pointB.x &&
      aData.pointB.y === bData.pointB.y
    );
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
  export function computeDynamicFillState(
    geometry: Entity<GeometryComponent>,
    filterData: MirrorFilterData,
  ): 'unchanged' | 'filled' {
    const polyData = GeometryComponent.get(geometry);
    if (polyData.type !== 'polygon' || polyData.closed) {
      return 'unchanged';
    }
    if (arePolygonEndpointsOnMirrorLine(filterData, polyData.points)) {
      return 'filled';
    }
    return 'unchanged';
  }

  /** Mirrors a point over an infinite line defined by two points. */
  function mirrorPointOverLine(
    point: SheetPosition,
    lineA: SheetPosition,
    lineB: SheetPosition,
  ): SheetPosition {
    const dx = lineB.x - lineA.x;
    const dy = lineB.y - lineA.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      return point;
    }
    const t = ((point.x - lineA.x) * dx + (point.y - lineA.y) * dy) / lenSq;
    const projX = lineA.x + t * dx;
    const projY = lineA.y + t * dy;
    return new SheetPosition(2 * projX - point.x, 2 * projY - point.y);
  }

  /** Given a filter, apply it to a list of {@link RenderShape}s, returning a new set of render
   * shapes which should be rendered instead. */
  export function applyToRenderShape(
    filterData: MirrorFilterData,
    shapes: Array<RenderShape>,
    generateFilterKey: () => string,
    options: GetRenderShapesOptions,
  ): Array<RenderShape> {
    return shapes.flatMap((renderShape) => {
      const key = generateFilterKey();

      switch (renderShape.shape) {
        case 'rectangle': {
          const corners = BoundingBox.cornersToArray(
            BoundingBox.corners(
              BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]),
            ),
          );
          const flippedCorners = corners.map((point) =>
            mirrorPointOverLine(point, filterData.pointA, filterData.pointB),
          );

          return [
            renderShape,
            RenderShape.polygon(
              key,
              [...flippedCorners, flippedCorners[0]].map((point) => ({
                type: 'point',
                point,
              })),
              { closed: true },
            ),
          ];
        }
        case 'ellipse': {
          // IMPORTANT: the below algorithm does not properly handle flipping over non 90 or 45
          // degree lines, since there isn't a way to represent a rotated rectangle currently.
          //
          // FIXME: Address this, it's a bug that is fairly noticable.

          const mirroredCenter = mirrorPointOverLine(
            renderShape.center,
            filterData.pointA,
            filterData.pointB,
          );
          return [
            renderShape,
            RenderShape.ellipse(key, mirroredCenter, {
              radiusX: renderShape.radiusX,
              radiusY: renderShape.radiusY,
            }),
          ];
        }
        case 'polygon': {
          const mirroredPoints = renderShape.points.map((segment) => {
            const mirroredPoint = mirrorPointOverLine(
              segment.point,
              filterData.pointA,
              filterData.pointB,
            );
            switch (segment.type) {
              case 'point':
                return { type: 'point' as const, point: mirroredPoint };
              case 'arc-quadratic':
                return {
                  type: 'arc-quadratic' as const,
                  point: mirroredPoint,
                  controlPoint: mirrorPointOverLine(
                    segment.controlPoint,
                    filterData.pointA,
                    filterData.pointB,
                  ),
                };
              case 'arc-cubic':
                return {
                  type: 'arc-cubic' as const,
                  point: mirroredPoint,
                  controlPointA: mirrorPointOverLine(
                    segment.controlPointA,
                    filterData.pointA,
                    filterData.pointB,
                  ),
                  controlPointB: mirrorPointOverLine(
                    segment.controlPointB,
                    filterData.pointA,
                    filterData.pointB,
                  ),
                };
              default:
                segment satisfies never;
                throw new Error(
                  `getRenderShapes: Unknown polygon segment type ${(segment as any).type}`,
                );
            }
          });

          // If a polygon which is non closed is mirrored across the mirror line and the start
          // and end points are both exactly ON the mirror line, then combine the two mirrored
          // halves into one filled polygon
          if (
            !renderShape.closed &&
            MirrorFilter.arePolygonEndpointsOnMirrorLine(filterData, renderShape.points)
          ) {
            // In some cases (ie, when rendering in ShapePreview), combining together the
            // polygons actually isn't what is desired, so that the mirrored part can be
            // rendered differently.
            //
            // In this case, return them seperately, though importantly, the mirrored section
            // is CLOSED! Which is different than what would happen normally.
            if (!options.combineNonClosedPolygons) {
              return [
                { ...renderShape, closed: true },
                RenderShape.polygon(key, mirroredPoints, { closed: true }),
              ];
            }

            const combined = [
              ...renderShape.points,
              // Flip around the mirrored points so it can continue where `renderShape`
              // left off.
              ...PolygonSegment.reverseList(mirroredPoints),
            ];
            return [
              RenderShape.polygon(key, combined, {
                closed: true,
                primary: renderShape.primary,
              }),
            ];
          }

          return [
            renderShape,
            RenderShape.polygon(key, mirroredPoints, {
              closed: renderShape.closed,
              primary: false,
            }),
          ];
        }
        default:
          renderShape satisfies never;
          throw new Error(
            `getRenderShapes: Unknown render shape type ${(renderShape as any).shape}`,
          );
      }
    });
  }
}

export type MirrorFilter = Entity<FilterComponent<MirrorFilterData>>;

export type MirrorFilterTemplate = Omit<Entity<FilterComponent<MirrorFilterData>>, 'id'>;
