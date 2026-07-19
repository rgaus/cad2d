import { BoundingBox, CornerReplacement, rectangleToPolygon } from '@/lib/math';
import { type UnitType } from '@/lib/units/length';
import {
  CubicCurve,
  KeyPoints,
  LineSegment,
  QuadraticCurve,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { Filter } from '../filters';
import { type Geometry, type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { type Entity, type EntityComponent, ResizeParams } from '../types';
import { ConstraintComponent } from './ConstraintComponent';
import { FilterComponent } from './FilterComponent';

export type RenderShape =
  | {
      shape: 'polygon';
      key: string;
      primary: boolean;
      points: Array<PolygonSegment>;
      closed: boolean;
    }
  | { shape: 'rectangle'; key: string; upperLeft: SheetPosition; lowerRight: SheetPosition }
  | { shape: 'ellipse'; key: string; center: SheetPosition; radiusX: number; radiusY: number };

namespace RenderShape {
  export function polygon(
    key: string,
    points: Array<PolygonSegment>,
    closed: boolean,
    options?: { primary?: boolean },
  ): RenderShape {
    return { shape: 'polygon' as const, key, primary: options?.primary ?? false, points, closed };
  }
  export function rectangle(
    key: string,
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
  ): RenderShape {
    return { shape: 'rectangle' as const, key, upperLeft, lowerRight };
  }
  export function ellipse(
    key: string,
    center: SheetPosition,
    args: { radiusX: number; radiusY: number },
  ): RenderShape {
    return { shape: 'ellipse' as const, key, center, radiusX: args.radiusX, radiusY: args.radiusY };
  }
}

/**
 * Entity component for a geometry - a rectangle, ellipse, or polygon.
 */
export type GeometryComponent<D extends GeometryData = GeometryData> = EntityComponent<
  'geometry',
  D
>;

export namespace GeometryComponent {
  export const key: keyof GeometryComponent = 'geometry';

  export function createPolygon(
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; openAtIndex?: number },
  ): GeometryComponent<PolygonData> {
    if (points.length < 2) {
      throw new Error(
        `GeometryComponent.createPolygon: points.length must be >= 2, found ${points.length}`,
      );
    }
    return {
      geometry: {
        type: 'polygon',
        points,
        closed: options?.closed ?? points[0].point === points.at(-1)!.point,
        openAtIndex: options?.openAtIndex ?? 0,
      },
    };
  }

  export function createRectangle(
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
  ): GeometryComponent<RectangleData> {
    return { geometry: { type: 'rectangle', upperLeft, lowerRight } };
  }

  export function createEllipse(
    center: SheetPosition,
    args: {
      radiusX: number;
      radiusY: number;
    },
  ): GeometryComponent<EllipseData> {
    return {
      geometry: {
        type: 'ellipse',
        center,
        radiusX: args.radiusX,
        radiusY: args.radiusY,
      },
    };
  }

  export function get<D extends GeometryData = GeometryData>(
    geometry: Entity<GeometryComponent<D>>,
  ): D {
    return geometry.components.geometry;
  }

  export function isPolygon(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<PolygonData>> {
    return geometry.components.geometry.type === 'polygon';
  }

  export function isRectangle(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<RectangleData>> {
    return geometry.components.geometry.type === 'rectangle';
  }

  export function isEllipse(
    geometry: Geometry,
  ): geometry is Entity<GeometryComponent<EllipseData>> {
    return geometry.components.geometry.type === 'ellipse';
  }

  export function update<
    Data extends GeometryData = GeometryData,
    Ent extends Entity<GeometryComponent<Data>> = Entity<GeometryComponent<Data>>,
  >(geometry: Ent, partial: Partial<Data>): Ent {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        geometry: { ...geometry.components.geometry, ...partial },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Entity<GeometryComponent>): KeyPoints<SheetPosition, string> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.keyPoints(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.keyPoints(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.keyPoints(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.keyPoints: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function boundingBox(geometry: Entity<GeometryComponent>): Rect<SheetPosition> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.boundingBox(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.boundingBox(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.boundingBox(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.boundingBox: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function translate<E extends Entity<GeometryComponent>>(
    geometry: E,
    transform: (input: SheetPosition) => SheetPosition,
  ): E {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.translate(
          geometry as Entity<GeometryComponent<PolygonData>>,
          transform,
        ) as E;
      case 'rectangle':
        return RectangleData.translate(
          geometry as Entity<GeometryComponent<RectangleData>>,
          transform,
        ) as E;
      case 'ellipse':
        return EllipseData.translate(
          geometry as Entity<GeometryComponent<EllipseData>>,
          transform,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.translate: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function getOrigin(geometry: Entity<GeometryComponent>): SheetPosition {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.getOrigin(geometry as Entity<GeometryComponent<PolygonData>>);
      case 'rectangle':
        return RectangleData.getOrigin(geometry as Entity<GeometryComponent<RectangleData>>);
      case 'ellipse':
        return EllipseData.getOrigin(geometry as Entity<GeometryComponent<EllipseData>>);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getOrigin: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function equals(a: Entity<GeometryComponent>, b: Entity<GeometryComponent>): boolean {
    const state = GeometryComponent.get(a);
    switch (state.type) {
      case 'polygon':
        return PolygonData.equals(a as Entity<GeometryComponent<PolygonData>>, b);
      case 'rectangle':
        return RectangleData.equals(a as Entity<GeometryComponent<RectangleData>>, b);
      case 'ellipse':
        return EllipseData.equals(a as Entity<GeometryComponent<EllipseData>>, b);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.equals: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function resize<E extends Entity<GeometryComponent>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.resize(
          geometry as Entity<GeometryComponent<PolygonData>>,
          params,
          originalBBox,
        ) as E;
      case 'rectangle':
        return RectangleData.resize(
          geometry as Entity<GeometryComponent<RectangleData>>,
          params,
          originalBBox,
        ) as E;
      case 'ellipse':
        return EllipseData.resize(
          geometry as Entity<GeometryComponent<EllipseData>>,
          params,
          originalBBox,
        ) as E;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.resize: Unknown geometry data type ${(state as any).type}`,
        );
    }
  }

  export function resizeBBox(
    bbox: Rect<SheetPosition>,
    params: ResizeParams,
  ): Rect<SheetPosition> | null {
    const upperLeft = bbox.position;
    const lowerRight = new SheetPosition(
      bbox.position.x + bbox.width,
      bbox.position.y + bbox.height,
    );

    let newUpperLeft = upperLeft;
    let newLowerRight = lowerRight;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;
      const centerX = (upperLeft.x + lowerRight.x) / 2;
      const centerY = (upperLeft.y + lowerRight.y) / 2;

      if (params.altHeld) {
        let dx: number;
        let dy: number;
        switch (corner) {
          case 'top-left':
            dx = centerX - params.to.x;
            dy = centerY - params.to.y;
            break;
          case 'top-right':
            dx = params.to.x - centerX;
            dy = centerY - params.to.y;
            break;
          case 'bottom-left':
            dx = centerX - params.to.x;
            dy = params.to.y - centerY;
            break;
          case 'bottom-right':
            dx = params.to.x - centerX;
            dy = params.to.y - centerY;
            break;
        }
        newUpperLeft = new SheetPosition(centerX - dx, centerY - dy);
        newLowerRight = new SheetPosition(centerX + dx, centerY + dy);
      } else {
        switch (corner) {
          case 'top-left':
            newUpperLeft = params.to;
            break;
          case 'top-right':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            break;
          case 'bottom-left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            break;
          case 'bottom-right':
            newLowerRight = params.to;
            break;
        }
      }

      if (params.shiftHeld || params.linkDimensions) {
        if (bbox.width === 0 || bbox.height === 0) {
          return null;
        }
        const aspectRatio = bbox.width / bbox.height;
        if (params.altHeld) {
          const dx = Math.abs(params.to.x - centerX);
          const dy = Math.abs(params.to.y - centerY);
          const scale = Math.max(dx / (bbox.width / 2), dy / (bbox.height / 2));
          const newW = bbox.width * scale;
          const newH = bbox.height * scale;
          newUpperLeft = new SheetPosition(centerX - newW / 2, centerY - newH / 2);
          newLowerRight = new SheetPosition(centerX + newW / 2, centerY + newH / 2);
        } else {
          let pivotX: number;
          let pivotY: number;
          switch (corner) {
            case 'top-left':
              pivotX = lowerRight.x;
              pivotY = lowerRight.y;
              break;
            case 'top-right':
              pivotX = upperLeft.x;
              pivotY = lowerRight.y;
              break;
            case 'bottom-left':
              pivotX = lowerRight.x;
              pivotY = upperLeft.y;
              break;
            case 'bottom-right':
              pivotX = upperLeft.x;
              pivotY = upperLeft.y;
              break;
          }
          const dx = Math.abs(params.to.x - pivotX);
          const dy = Math.abs(params.to.y - pivotY);
          const scale = Math.max(dx / bbox.width, dy / bbox.height);
          const newW = bbox.width * scale;
          const newH = bbox.height * scale;
          switch (corner) {
            case 'top-left':
              newUpperLeft = new SheetPosition(pivotX - newW, pivotY - newH);
              newLowerRight = new SheetPosition(pivotX, pivotY);
              break;
            case 'top-right':
              newUpperLeft = new SheetPosition(pivotX, pivotY - newH);
              newLowerRight = new SheetPosition(pivotX + newW, pivotY);
              break;
            case 'bottom-left':
              newUpperLeft = new SheetPosition(pivotX - newW, pivotY);
              newLowerRight = new SheetPosition(pivotX, pivotY + newH);
              break;
            case 'bottom-right':
              newUpperLeft = new SheetPosition(pivotX, pivotY);
              newLowerRight = new SheetPosition(pivotX + newW, pivotY + newH);
              break;
          }
        }
      }
    } else {
      const edge = params.mode.edge;
      const originalWidth = lowerRight.x - upperLeft.x;
      const originalHeight = lowerRight.y - upperLeft.y;

      if (params.altHeld) {
        const centerX = (upperLeft.x + lowerRight.x) / 2;
        const centerY = (upperLeft.y + lowerRight.y) / 2;
        const halfWidth = originalWidth / 2;
        const halfHeight = originalHeight / 2;

        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(centerX - halfWidth, params.to.y);
            newLowerRight = new SheetPosition(
              centerX + halfWidth,
              centerY + halfHeight + (upperLeft.y - params.to.y),
            );
            if (params.shiftHeld || params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'bottom':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth,
              centerY - halfHeight - (params.to.y - lowerRight.y),
            );
            newLowerRight = new SheetPosition(centerX + halfWidth, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, centerY - halfHeight);
            newLowerRight = new SheetPosition(
              centerX + halfWidth + (upperLeft.x - params.to.x),
              centerY + halfHeight,
            );
            if (params.shiftHeld || params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth - (params.to.x - lowerRight.x),
              centerY - halfHeight,
            );
            newLowerRight = new SheetPosition(params.to.x, centerY + halfHeight);
            if (params.shiftHeld || params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
        }
      } else {
        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = upperLeft.y - params.to.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, params.to.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, lowerRight.y);
            }
            break;
          case 'bottom':
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = params.to.y - lowerRight.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, upperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, params.to.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = upperLeft.x - params.to.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(params.to.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(lowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = params.to.x - lowerRight.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(upperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(params.to.x, centerY + newHeight / 2);
            }
            break;
        }
      }
    }

    const ul = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lr = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );
    if (ul.x !== lr.x && ul.y !== lr.y) {
      return { position: ul, width: lr.x - ul.x, height: lr.y - ul.y };
    }
    return null;
  }

  export function addPointOnEdge<G extends Entity<GeometryComponent<PolygonData>>>(
    geometry: G,
    constraints: Array<Entity<ConstraintComponent>>,
    segmentIndex: number,
    newPointPosition: { type: 't'; t: number } | { type: 'point'; point: SheetPosition },
  ) {
    return PolygonData.addPointOnEdge(geometry, constraints, segmentIndex, newPointPosition);
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

  export function getRenderShapes(
    geometry: Entity<GeometryComponent<GeometryData>>,
    sheetDefaultUnit: UnitType,
    filters: Array<Filter> = [],
  ): Array<RenderShape> {
    let shapes;

    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        shapes = [RenderShape.polygon(geometry.id, state.points, state.closed, { primary: true })];
        break;
      case 'rectangle':
        shapes = [RenderShape.rectangle(geometry.id, state.upperLeft, state.lowerRight)];
        break;
      case 'ellipse':
        shapes = [
          RenderShape.ellipse(geometry.id, state.center, {
            radiusX: state.radiusX,
            radiusY: state.radiusY,
          }),
        ];
        break;
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.getRenderShapes: Unknown geometry data type ${(state as any).type}`,
        );
    }

    let filterApplicationCounter = 0;
    for (const filter of filters) {
      const data = FilterComponent.get(filter);
      switch (data.type) {
        case 'mirror': {
          const mirrorResults = shapes.flatMap((renderShape) => {
            filterApplicationCounter += 1;
            const key = `${filter.id}_${filterApplicationCounter}`;

            switch (renderShape.shape) {
              case 'rectangle': {
                // IMPORTANT: the below algorithm does not properly handle flipping over non 90 or 45
                // degree lines, since there isn't a way to represent a rotated rectangle currently.
                //
                // FIXME: Address this, it's a bug that is fairly noticable.
                const corners = BoundingBox.cornersToArray(
                  BoundingBox.corners(
                    BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]),
                  ),
                );
                const flippedCorners = corners.map((point) =>
                  mirrorPointOverLine(point, data.pointA, data.pointB),
                );
                const ul = new SheetPosition(
                  Math.min(...flippedCorners.map((p) => p.x)),
                  Math.min(...flippedCorners.map((p) => p.y)),
                );
                const lr = new SheetPosition(
                  Math.max(...flippedCorners.map((p) => p.x)),
                  Math.max(...flippedCorners.map((p) => p.y)),
                );
                return [RenderShape.rectangle(key, ul, lr)];
              }
              case 'ellipse': {
                const mirroredCenter = mirrorPointOverLine(
                  renderShape.center,
                  data.pointA,
                  data.pointB,
                );
                return [
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
                    data.pointA,
                    data.pointB,
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
                          data.pointA,
                          data.pointB,
                        ),
                      };
                    case 'arc-cubic':
                      return {
                        type: 'arc-cubic' as const,
                        point: mirroredPoint,
                        controlPointA: mirrorPointOverLine(
                          segment.controlPointA,
                          data.pointA,
                          data.pointB,
                        ),
                        controlPointB: mirrorPointOverLine(
                          segment.controlPointB,
                          data.pointA,
                          data.pointB,
                        ),
                      };
                    default:
                      segment satisfies never;
                      throw new Error(
                        `getRenderShapes: Unknown polygon segment type ${(segment as any).type}`,
                      );
                  }
                });
                return [
                  RenderShape.polygon(key, mirroredPoints, renderShape.closed, {
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
          shapes.push(...mirrorResults);
          break;
        }
        case 'fillet':
        case 'chamfer': {
          const factory =
            data.type === 'fillet'
              ? CornerReplacement.filletArc<SheetPosition>
              : CornerReplacement.chamferLine<SheetPosition>;
          const offsetNum = data.offset.toSheetUnits(sheetDefaultUnit).magnitude;

          let resultSegs: Array<
            LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>
          > | null = null;

          switch (data.geometryType) {
            case 'rectangle':
              if (GeometryComponent.isRectangle(geometry)) {
                const state = GeometryComponent.get(geometry);
                resultSegs = CornerReplacement.applyToRectangle(
                  state.upperLeft,
                  state.lowerRight,
                  data.pointCenterKeyPoint,
                  offsetNum,
                  factory,
                ).segments;
              }
              break;
            case 'polygon':
              if (GeometryComponent.isPolygon(geometry)) {
                const state = GeometryComponent.get(geometry);

                // Convert polygon points to viewport segments
                const n = state.points.length;
                const viewportSegs: Array<
                  LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>
                > = [];
                for (let i = 0; i < n - 1; i += 1) {
                  viewportSegs.push(
                    PolygonSegment.toLineSegmentOrCurve(state.points[i].point, state.points[i + 1]),
                  );
                }
                // Find the viewport segment index whose end is the center vertex
                const cornerIndex =
                  (data.pointCenterIndex - 1 + viewportSegs.length) % viewportSegs.length;

                resultSegs = CornerReplacement.applyToPolygon(
                  viewportSegs,
                  cornerIndex,
                  offsetNum,
                  factory,
                ).segments;
              }
              break;
            default:
              data satisfies never;
              throw new Error(`GeometryComponent.getRenderShapes: Unknown fillet / chamfer filter geometryType ${(data as any).geometryType}`);
          }

          if (!resultSegs) {
            break;
          }

          // Convert viewport segments back to PolygonSegment[]
          const newPoints: Array<PolygonSegment> = [];
          const [firstPoint] = PolygonSegment.fromLineSegmentOrCurve(resultSegs[0]);
          newPoints.push({ type: 'point', point: firstPoint });
          for (const seg of resultSegs) {
            const [, polySeg] = PolygonSegment.fromLineSegmentOrCurve(seg);
            newPoints.push(polySeg);
          }

          shapes = [RenderShape.polygon(geometry.id, newPoints, true)];
          break;
        }
        default:
          data satisfies never;
          break;
      }
    }

    return shapes;
  }
}
