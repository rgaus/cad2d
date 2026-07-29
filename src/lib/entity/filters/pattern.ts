import { BoundingBox, closestPointOnSegment } from '@/lib/math';
import { lineLineIntersection } from '@/lib/math/intersection';
import { Angle } from '@/lib/units/angle';
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
  >(
    filterData: F,
    points: Array<PolygonSegment>,
  ): 'clockwise-wind' | 'counter-clockwise-wind' | null {
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
          closestPointOnSegment(filterData.center, leftCornerPoint, firstPoint).distance < 1e-10 &&
          closestPointOnSegment(filterData.center, rightCornerPoint, lastPoint).distance < 1e-10
        ) {
          return 'counter-clockwise-wind';
        }

        if (
          closestPointOnSegment(filterData.center, rightCornerPoint, firstPoint).distance < 1e-10 &&
          closestPointOnSegment(filterData.center, leftCornerPoint, lastPoint).distance < 1e-10
        ) {
          return 'clockwise-wind';
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

  /** Rotates a point around a center point by the given angle in degrees. */
  function rotatePointAround(
    point: SheetPosition,
    center: SheetPosition,
    angleDeg: number,
  ): SheetPosition {
    const rad = Angle.degrees(angleDeg).toRadians().magnitude;
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return new SheetPosition(center.x + dx * cos - dy * sin, center.y + dx * sin + dy * cos);
  }

  export function applyToRenderShape(
    filterData: PatternFilterData,
    shapes: Array<RenderShape>,
    generateFilterKey: () => string,
    options: GetRenderShapesOptions,
  ): Array<RenderShape> {
    switch (filterData.mode) {
      case 'grid': {
        const dx = filterData.lowerRight.x - filterData.upperLeft.x;
        const dy = filterData.lowerRight.y - filterData.upperLeft.y;

        return shapes.flatMap((renderShape) => {
          const copies: Array<RenderShape> = [];

          for (let i = 0; i < filterData.xRepeats; i += 1) {
            for (let j = 0; j < filterData.yRepeats; j += 1) {
              if (i === 0 && j === 0) {
                continue;
              }
              const key = generateFilterKey();
              const offsetX = i * dx;
              const offsetY = j * dy;

              switch (renderShape.shape) {
                case 'rectangle': {
                  copies.push(
                    RenderShape.rectangle(
                      key,
                      new SheetPosition(
                        renderShape.upperLeft.x + offsetX,
                        renderShape.upperLeft.y + offsetY,
                      ),
                      new SheetPosition(
                        renderShape.lowerRight.x + offsetX,
                        renderShape.lowerRight.y + offsetY,
                      ),
                      { primary: false },
                    ),
                  );
                  break;
                }
                case 'ellipse': {
                  copies.push(
                    RenderShape.ellipse(
                      key,
                      new SheetPosition(
                        renderShape.center.x + offsetX,
                        renderShape.center.y + offsetY,
                      ),
                      {
                        radiusX: renderShape.radiusX,
                        radiusY: renderShape.radiusY,
                        primary: false,
                      },
                    ),
                  );
                  break;
                }
                case 'polygon': {
                  const translatedPoints = renderShape.points.map((segment) => {
                    const translatedPoint = new SheetPosition(
                      segment.point.x + offsetX,
                      segment.point.y + offsetY,
                    );
                    switch (segment.type) {
                      case 'point':
                        return { type: 'point' as const, point: translatedPoint };
                      case 'arc-quadratic':
                        return {
                          type: 'arc-quadratic' as const,
                          point: translatedPoint,
                          controlPoint: new SheetPosition(
                            segment.controlPoint.x + offsetX,
                            segment.controlPoint.y + offsetY,
                          ),
                        };
                      case 'arc-cubic':
                        return {
                          type: 'arc-cubic' as const,
                          point: translatedPoint,
                          controlPointA: new SheetPosition(
                            segment.controlPointA.x + offsetX,
                            segment.controlPointA.y + offsetY,
                          ),
                          controlPointB: new SheetPosition(
                            segment.controlPointB.x + offsetX,
                            segment.controlPointB.y + offsetY,
                          ),
                        };
                      default:
                        segment satisfies never;
                        throw new Error(
                          `getRenderShapes pattern grid: Unknown polygon segment type ${(segment as any).type}`,
                        );
                    }
                  });

                  copies.push(
                    RenderShape.polygon(key, translatedPoints, {
                      closed: renderShape.closed,
                      primary: false,
                    }),
                  );
                  break;
                }
                default:
                  renderShape satisfies never;
                  throw new Error(
                    `getRenderShapes pattern grid: Unknown render shape type ${(renderShape as any).shape}`,
                  );
              }
            }
          }

          return [renderShape, ...copies];
        });
      }
      case 'radial': {
        const angleStep = 360 / filterData.repeats.count;

        return shapes.flatMap((renderShape) => {
          const copies: Array<RenderShape> = [];

          for (let i = 1; i < filterData.repeats.count; i += 1) {
            const angle = i * angleStep;
            const key = generateFilterKey();

            switch (renderShape.shape) {
              case 'rectangle': {
                const corners = BoundingBox.cornersToArray(
                  BoundingBox.corners(
                    BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]),
                  ),
                );
                const rotatedCorners = corners.map((corner) =>
                  rotatePointAround(corner, filterData.center, angle),
                );
                copies.push(
                  RenderShape.polygon(
                    key,
                    [...rotatedCorners, rotatedCorners[0]].map((point) => ({
                      type: 'point',
                      point,
                    })),
                    { closed: true, primary: false },
                  ),
                );
                break;
              }
              case 'ellipse': {
                copies.push(
                  RenderShape.ellipse(
                    key,
                    rotatePointAround(renderShape.center, filterData.center, angle),
                    {
                      radiusX: renderShape.radiusX,
                      radiusY: renderShape.radiusY,
                      primary: false,
                    },
                  ),
                );
                break;
              }
              case 'polygon': {
                const polygonTouchingSidesAndWinding = !renderShape.closed
                  ? PatternFilter.arePolygonEndpointsOnEdgeLine(filterData, renderShape.points)
                  : null;

                if (polygonTouchingSidesAndWinding !== null) {
                  /** Rotates the polygon's points by the given angle around the center. */
                  const rotatedCopy = (angle: number): Array<PolygonSegment> =>
                    renderShape.points.map((segment) => {
                      const rotatedPoint = rotatePointAround(
                        segment.point,
                        filterData.center,
                        angle,
                      );
                      switch (segment.type) {
                        case 'point':
                          return { type: 'point' as const, point: rotatedPoint };
                        case 'arc-quadratic':
                          return {
                            type: 'arc-quadratic' as const,
                            point: rotatedPoint,
                            controlPoint: rotatePointAround(
                              segment.controlPoint,
                              filterData.center,
                              angle,
                            ),
                          };
                        case 'arc-cubic':
                          return {
                            type: 'arc-cubic' as const,
                            point: rotatedPoint,
                            controlPointA: rotatePointAround(
                              segment.controlPointA,
                              filterData.center,
                              angle,
                            ),
                            controlPointB: rotatePointAround(
                              segment.controlPointB,
                              filterData.center,
                              angle,
                            ),
                          };
                        default:
                          segment satisfies never;
                          throw new Error(
                            `getRenderShapes pattern radial merge: Unknown polygon segment type ${(segment as any).type}`,
                          );
                      }
                    });

                  if (!options.combineNonClosedPolygons) {
                    const results: Array<RenderShape> = [];
                    for (let i = 0; i < filterData.repeats.count; i += 1) {
                      const key = generateFilterKey();

                      // Add the center point into the generated output, so it goes a) shape, b)
                      // center, c) back to starting point.
                      const segments = rotatedCopy(i * angleStep);
                      const segmentsWithCenter = [
                        ...segments,
                        { type: 'point' as const, point: filterData.center },
                        { type: 'point' as const, point: segments[0].point },
                      ];

                      results.push(
                        RenderShape.polygon(key, segmentsWithCenter, {
                          closed: true,
                          primary: i === 0 ? renderShape.primary : false,
                        }),
                      );
                    }
                    return results;
                  }

                  // Chain all rotated copies around the center with gap fillers
                  const chain: Array<PolygonSegment> = [];

                  if (polygonTouchingSidesAndWinding === 'clockwise-wind') {
                    // Case A: p0 on LEFT, pN on RIGHT -- chain CCW
                    for (let i = 0; i < filterData.repeats.count; i += 1) {
                      const copy = rotatedCopy(i * angleStep);
                      if (chain.length > 0) {
                        const lastPt = chain[chain.length - 1].point;
                        const firstPt = copy[0].point;
                        if (lastPt.x !== firstPt.x || lastPt.y !== firstPt.y) {
                          chain.push({ type: 'point', point: firstPt });
                        }
                      }
                      chain.push(...copy);
                    }
                  } else {
                    // Case B: p0 on RIGHT, pN on LEFT -- chain going backward
                    // around the circle (copy at (count-1)*step, ..., copy at 1*step)
                    for (let i = filterData.repeats.count; i > 0; i -= 1) {
                      const copy = rotatedCopy(i * angleStep);
                      if (chain.length > 0) {
                        const lastPt = chain[chain.length - 1].point;
                        const firstPt = copy[0].point;
                        if (lastPt.x !== firstPt.x || lastPt.y !== firstPt.y) {
                          chain.push({ type: 'point', point: firstPt });
                        }
                      }
                      chain.push(...copy);
                    }
                  }

                  // Close back to start with a gap filler if needed
                  const firstPt = chain[0].point;
                  const lastPt = chain[chain.length - 1].point;
                  if (lastPt.x !== firstPt.x || lastPt.y !== firstPt.y) {
                    chain.push({ type: 'point', point: firstPt });
                  }

                  const key = generateFilterKey();
                  return [
                    RenderShape.polygon(key, chain, {
                      closed: true,
                      primary: renderShape.primary,
                    }),
                  ];
                }

                // Non-merging path: generate rotated copies separately
                // This block only runs for the current iteration of the for loop
                // because we are inside a flatMap callback for a single render shape
                // that doesn't merge. Each subsequent iteration handles different
                // render shapes from the shapes array.
                const copies: Array<RenderShape> = [];
                for (let i = 1; i < filterData.repeats.count; i += 1) {
                  const angle = i * angleStep;
                  const key = generateFilterKey();

                  const rotatedPoints = renderShape.points.map((segment) => {
                    const rotatedPoint = rotatePointAround(segment.point, filterData.center, angle);
                    switch (segment.type) {
                      case 'point':
                        return {
                          type: 'point' as const,
                          point: rotatedPoint,
                        };
                      case 'arc-quadratic':
                        return {
                          type: 'arc-quadratic' as const,
                          point: rotatedPoint,
                          controlPoint: rotatePointAround(
                            segment.controlPoint,
                            filterData.center,
                            angle,
                          ),
                        };
                      case 'arc-cubic':
                        return {
                          type: 'arc-cubic' as const,
                          point: rotatedPoint,
                          controlPointA: rotatePointAround(
                            segment.controlPointA,
                            filterData.center,
                            angle,
                          ),
                          controlPointB: rotatePointAround(
                            segment.controlPointB,
                            filterData.center,
                            angle,
                          ),
                        };
                      default:
                        segment satisfies never;
                        throw new Error(
                          `getRenderShapes pattern radial: Unknown polygon segment type ${(segment as any).type}`,
                        );
                    }
                  });

                  copies.push(
                    RenderShape.polygon(key, rotatedPoints, {
                      closed: renderShape.closed,
                      primary: false,
                    }),
                  );
                }

                return [renderShape, ...copies];
              }
              default:
                renderShape satisfies never;
                throw new Error(
                  `getRenderShapes pattern radial: Unknown render shape type ${(renderShape as any).shape}`,
                );
            }
          }

          return [renderShape, ...copies];
        });
      }
      default:
        filterData satisfies never;
        throw new Error(`No pattern filter of mode=${(filterData as any).mode} found!`);
    }
  }
}

export type PatternFilter = Entity<FilterComponent<PatternFilterData>>;

export type PatternGridFilterTemplate = Omit<Entity<FilterComponent<PatternGridFilterData>>, 'id'>;
export type PatternRadialFilterTemplate = Omit<
  Entity<FilterComponent<PatternRadialFilterData>>,
  'id'
>;

export type PatternFilterTemplate = PatternGridFilterTemplate | PatternRadialFilterTemplate;
