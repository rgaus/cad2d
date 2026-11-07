import { BoundingBox, OrientedBoundingBox, ellipseToPolygon, rotatePointAround } from '@/lib/math';
import { OrientedRect, SheetPosition } from '@/lib/viewport/types';
import { PolygonSegment } from './geometry/polygon';

export type RenderShapePolygon = {
  shape: 'polygon';
  key: string;
  primary: boolean;
  points: Array<PolygonSegment>;
  closed: boolean;
};
export type RenderShapeRectangle = {
  shape: 'rectangle';
  key: string;
  primary: boolean;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  angleDegrees: number;
};
export type RenderShapeEllipse = {
  shape: 'ellipse';
  key: string;
  primary: boolean;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  angleDegrees: number;
};
export type RenderShapePoint = {
  shape: 'point';
  key: string;
  primary: boolean;
  position: SheetPosition;
};

export type RenderShape =
  | RenderShapePolygon
  | RenderShapeRectangle
  | RenderShapeEllipse
  | RenderShapePoint;

export namespace RenderShape {
  export function polygon(
    key: string,
    points: Array<PolygonSegment>,
    options?: { closed?: boolean; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'polygon' as const,
      key,
      primary: options?.primary ?? false,
      points,
      closed: options?.closed ?? false,
    };
  }
  export function rectangle(
    key: string,
    upperLeft: SheetPosition,
    lowerRight: SheetPosition,
    options?: { primary?: boolean; angleDegrees?: number },
  ): RenderShape {
    return {
      shape: 'rectangle' as const,
      key,
      primary: options?.primary ?? false,
      upperLeft,
      lowerRight,
      angleDegrees: options?.angleDegrees ?? 0,
    };
  }
  export function ellipse(
    key: string,
    center: SheetPosition,
    args: { radiusX: number; radiusY: number; primary?: boolean; angleDegrees?: number },
  ): RenderShape {
    return {
      shape: 'ellipse' as const,
      key,
      primary: args?.primary ?? false,
      center,
      radiusX: args.radiusX,
      radiusY: args.radiusY,
      angleDegrees: args?.angleDegrees ?? 0,
    };
  }
  export function point(
    key: string,
    position: SheetPosition,
    options?: { primary?: boolean },
  ): RenderShape {
    return {
      shape: 'point' as const,
      key,
      primary: options?.primary ?? false,
      position,
    };
  }

  /** The oriented bounding box of a render shape in rendered sheet space. */
  export function orientedBoundingBox(renderShape: RenderShape): OrientedRect<SheetPosition> {
    switch (renderShape.shape) {
      case 'polygon':
        return OrientedBoundingBox.fromRect(
          BoundingBox.fromPoints(renderShape.points.map((p) => p.point)),
        );
      case 'rectangle':
        return {
          position: renderShape.upperLeft,
          width: renderShape.lowerRight.x - renderShape.upperLeft.x,
          height: renderShape.lowerRight.y - renderShape.upperLeft.y,
          angleDegrees: renderShape.angleDegrees,
        };
      case 'ellipse': {
        const localUpperLeft = new SheetPosition(
          renderShape.center.x - renderShape.radiusX,
          renderShape.center.y - renderShape.radiusY,
        );
        return {
          position: rotatePointAround(localUpperLeft, renderShape.center, renderShape.angleDegrees),
          width: renderShape.radiusX * 2,
          height: renderShape.radiusY * 2,
          angleDegrees: renderShape.angleDegrees,
        };
      }
      case 'point':
        return OrientedBoundingBox.fromRect({
          position: renderShape.position,
          width: 0,
          height: 0,
        });
      default:
        renderShape satisfies never;
        throw new Error(
          `RenderShape.orientedBoundingBox: Unknown render shape ${(renderShape as any).shape}`,
        );
    }
  }

  /** Axis-aligned bounding box of a render shape in rendered sheet space. */
  export function boundingBox(renderShape: RenderShape) {
    return OrientedBoundingBox.toRect(orientedBoundingBox(renderShape));
  }

  /** Converts any render shape into a sheet-space path made of polygon segments. */
  export function toPolygonSegments(renderShape: RenderShape): Array<PolygonSegment> {
    switch (renderShape.shape) {
      case 'polygon':
        return renderShape.points;
      case 'rectangle': {
        const corners = OrientedBoundingBox.corners({
          position: renderShape.upperLeft,
          width: renderShape.lowerRight.x - renderShape.upperLeft.x,
          height: renderShape.lowerRight.y - renderShape.upperLeft.y,
          angleDegrees: renderShape.angleDegrees,
        });
        return [
          { type: 'point', point: corners.upperLeft },
          { type: 'point', point: corners.upperRight },
          { type: 'point', point: corners.lowerRight },
          { type: 'point', point: corners.lowerLeft },
          { type: 'point', point: corners.upperLeft },
        ];
      }
      case 'ellipse':
        return ellipseToPolygon(renderShape.center, renderShape.radiusX, renderShape.radiusY).map(
          (segment) =>
            PolygonSegment.transform(segment, (position) =>
              rotatePointAround(position, renderShape.center, renderShape.angleDegrees),
            ),
        );
      case 'point':
        return [{ type: 'point', point: renderShape.position }];
      default:
        renderShape satisfies never;
        throw new Error(
          `RenderShape.toPolygonSegments: Unknown render shape ${(renderShape as any).shape}`,
        );
    }
  }
}
