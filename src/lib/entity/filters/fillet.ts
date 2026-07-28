import { Length } from '@/lib/units/length';
import type { UnitType } from '@/lib/units/length';
import { Entity, type Polygon, PolygonSegment, type Rectangle, RectangleEndpoint, RenderShape } from '..';
import { FilterComponent } from '../components/FilterComponent';
import { ChamferFilterData } from './chamfer';
import { BoundingBox, CornerReplacement } from '@/lib/math';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '@/lib/viewport/types';

export type FilletFilterData =
  | {
      type: 'fillet';
      offset: Length;
      geometryType: 'polygon';
      geometryId: Polygon['id'];
      pointAIndex: number;
      pointCenterIndex: number;
      pointBIndex: number;
    }
  | {
      type: 'fillet';
      offset: Length;
      geometryType: 'rectangle';
      geometryId: Rectangle['id'];
      pointAKeyPoint: RectangleEndpoint;
      pointCenterKeyPoint: RectangleEndpoint;
      pointBKeyPoint: RectangleEndpoint;
    };

export namespace FilletFilter {
  /** Creates a new fillet filter associated with a polygon's vertex. */
  export function createOnPolygon(
    polygonId: Polygon['id'],
    pointAIndex: number,
    pointCenterIndex: number,
    pointBIndex: number,
    offset: Length,
  ): FilletFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'fillet',
        offset,

        geometryType: 'polygon',
        geometryId: polygonId,
        pointAIndex,
        pointCenterIndex,
        pointBIndex,
      }),
    };
  }

  /** Creates a new fillet filter associated with a rectangle's corner key points. */
  export function createOnRectangle(
    rectangleId: Rectangle['id'],
    pointAKeyPoint: RectangleEndpoint,
    pointCenterKeyPoint: RectangleEndpoint,
    pointBKeyPoint: RectangleEndpoint,
    offset: Length,
  ): FilletFilterTemplate {
    return {
      components: FilterComponent.create({
        type: 'fillet',
        offset,

        geometryType: 'rectangle',
        geometryId: rectangleId,
        pointAKeyPoint,
        pointCenterKeyPoint,
        pointBKeyPoint,
      }),
    };
  }

  export function equals(a: Entity<FilterComponent<FilletFilterData>>, b: Entity<FilterComponent>) {
    const aData = FilterComponent.get(a);
    const bData = FilterComponent.get(b);
    if (bData.type !== 'fillet') {
      return false;
    }
    return (
      aData.geometryId === bData.geometryId &&
      aData.geometryType === bData.geometryType &&
      aData.offset.type === bData.offset.type &&
      aData.offset.magnitude === bData.offset.magnitude
    );
  }

  /** Given a filter, apply it to a list of {@link RenderShape}s, returning a new set of render
    * shapes which should be rendered instead. */
  export function applyToRenderShape(
    filterData: FilletFilterData | ChamferFilterData,
    shapes: Array<RenderShape>,
    generateFilterKey: () => string,
    sheetDefaultUnit: UnitType,
  ): Array<RenderShape> {
    const factory =
      filterData.type === 'fillet'
        ? CornerReplacement.filletArc<SheetPosition>
        : CornerReplacement.chamferLine<SheetPosition>;
    const offsetNum = filterData.offset.toSheetUnits(sheetDefaultUnit).magnitude;

    return shapes.flatMap((renderShape) => {
      const key = generateFilterKey();

      let resultSegs: Array<
        LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>
      >;
      let closed = false;

      switch (renderShape.shape) {
        case 'rectangle': {
          switch (filterData.geometryType) {
            case 'rectangle':
              resultSegs = CornerReplacement.applyToRectangle(
                renderShape.upperLeft,
                renderShape.lowerRight,
                filterData.pointCenterKeyPoint,
                offsetNum,
                factory,
              ).segments;
              closed = true;
              break;
            case 'polygon':
              console.warn(
                'GeometryComponent.getRenderShapes: applying fillet/chamfer - geoemtryType of polygon cannot apply to renderShape of rectangle, skipping...',
              );
              return [];
            default:
              filterData satisfies never;
              return [];
          }
          break;
        }
        case 'polygon': {
          // Convert polygon points to viewport segments
          const pointsLength = renderShape.points.length;
          const viewportSegs: Array<
            | LineSegment<SheetPosition>
            | QuadraticCurve<SheetPosition>
            | CubicCurve<SheetPosition>
          > = [];
          for (let i = 0; i < pointsLength - 1; i += 1) {
            viewportSegs.push(
              PolygonSegment.toLineSegmentOrCurve(
                renderShape.points[i].point,
                renderShape.points[i + 1],
              ),
            );
          }

          switch (filterData.geometryType) {
            case 'rectangle': {
              // Skip non corner points
              if (
                filterData.pointCenterKeyPoint !== 'upperLeft' &&
                filterData.pointCenterKeyPoint !== 'upperRight' &&
                filterData.pointCenterKeyPoint !== 'lowerLeft' &&
                filterData.pointCenterKeyPoint !== 'lowerRight'
              ) {
                return [];
              }

              // Find the viewport segment index whose end is the center vertex
              const cornerPositions = BoundingBox.corners(
                BoundingBox.fromPoints(renderShape.points.map((p) => p.point)),
              );
              const centerPos = cornerPositions[filterData.pointCenterKeyPoint];
              // Find the center vertex index in the polygon
              let centerPtIndex: number | null = null;
              for (let i = 0; i < pointsLength - 1; i += 1) {
                if (
                  renderShape.points[i].point.x === centerPos.x &&
                  renderShape.points[i].point.y === centerPos.y
                ) {
                  centerPtIndex = i;
                  break;
                }
              }
              if (centerPtIndex === null) {
                return [];
              }
              const cornerIndex =
                (centerPtIndex - 1 + viewportSegs.length) % viewportSegs.length;

              resultSegs = CornerReplacement.applyToPolygon(
                viewportSegs,
                cornerIndex,
                offsetNum,
                factory,
              ).segments;
              closed = renderShape.closed;
              break;
            }
            case 'polygon': {
              // Find the viewport segment index whose end is the center vertex
              const cornerIndex =
                (filterData.pointCenterIndex - 1 + viewportSegs.length) % viewportSegs.length;

              resultSegs = CornerReplacement.applyToPolygon(
                viewportSegs,
                cornerIndex,
                offsetNum,
                factory,
              ).segments;
              closed = renderShape.closed;
              break;
            }
            default:
              filterData satisfies never;
              return [];
          }
          break;
        }
        case 'ellipse':
          // Ellipses can't have fillets / chamfers
          // So just pass through unchanged
          return [renderShape];
        default:
          renderShape satisfies never;
          throw new Error(
            `getRenderShapes: Unknown render shape type ${(renderShape as any).shape}`,
          );
      }

      // Convert viewport segments back to PolygonSegment[]
      const newPoints: Array<PolygonSegment> = [];
      const [firstPoint] = PolygonSegment.fromLineSegmentOrCurve(resultSegs[0]);
      newPoints.push({ type: 'point', point: firstPoint });
      for (const seg of resultSegs) {
        const [, polySeg] = PolygonSegment.fromLineSegmentOrCurve(seg);
        newPoints.push(polySeg);
      }

      return [RenderShape.polygon(key, newPoints, { closed, primary: renderShape.primary })];
    });
  }
}

export type FilletFilter = Entity<FilterComponent<FilletFilterData>>;

export type FilletFilterTemplate = Omit<Entity<FilterComponent<FilletFilterData>>, 'id'>;
