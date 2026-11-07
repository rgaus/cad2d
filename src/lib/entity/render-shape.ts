import { SheetPosition } from '@/lib/viewport/types';
import { BoundingBox } from '@/lib/math';
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
};
export type RenderShapeEllipse = {
  shape: 'ellipse';
  key: string;
  primary: boolean;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
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
    options?: { primary?: boolean },
  ): RenderShape {
    return {
      shape: 'rectangle' as const,
      key,
      primary: options?.primary ?? false,
      upperLeft,
      lowerRight,
    };
  }
  export function ellipse(
    key: string,
    center: SheetPosition,
    args: { radiusX: number; radiusY: number; primary?: boolean },
  ): RenderShape {
    return {
      shape: 'ellipse' as const,
      key,
      primary: args?.primary ?? false,
      center,
      radiusX: args.radiusX,
      radiusY: args.radiusY,
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

  export function boundingBox(renderShape: RenderShape) {
    switch (renderShape.shape) {
      case 'polygon':
        return BoundingBox.fromPoints(renderShape.points.map((p) => p.point));
      case 'rectangle':
        return BoundingBox.fromPoints([renderShape.upperLeft, renderShape.lowerRight]);
      case 'ellipse':
        return BoundingBox.fromPoints([
          renderShape.center,
          new SheetPosition(renderShape.center.x, renderShape.center.y + renderShape.radiusY),
          new SheetPosition(renderShape.center.x, renderShape.center.y - renderShape.radiusY),
          new SheetPosition(renderShape.center.x + renderShape.radiusX, renderShape.center.y),
          new SheetPosition(renderShape.center.x - renderShape.radiusX, renderShape.center.y),
        ]);
      case 'point':
        return { position: renderShape.position, width: 0, height: 0 };
      default:
        renderShape satisfies never;
        throw new Error(
          `RenderShape.boundingBox: Unknown render shape ${(renderShape as any).shape}`,
        );
    }
  }
}
