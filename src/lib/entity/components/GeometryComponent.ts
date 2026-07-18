import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { type Geometry, type GeometryData } from '../geometry';
import { EllipseData } from '../geometry/ellipse';
import { PolygonData, PolygonSegment } from '../geometry/polygon';
import { RectangleData } from '../geometry/rectangle';
import { type Entity, type EntityComponent, ResizeParams } from '../types';
import { ConstraintComponent } from './ConstraintComponent';

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
          `GeometryComponent.keyPoints: Unknown polygon data type ${(state as any).type}`,
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
          `GeometryComponent.boundingBox: Unknown polygon data type ${(state as any).type}`,
        );
    }
  }

  export function translate(
    geometry: Entity<GeometryComponent>,
    transform: (input: SheetPosition) => SheetPosition,
  ): Entity<GeometryComponent> {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.translate(geometry as Entity<GeometryComponent<PolygonData>>, transform);
      case 'rectangle':
        return RectangleData.translate(
          geometry as Entity<GeometryComponent<RectangleData>>,
          transform,
        );
      case 'ellipse':
        return EllipseData.translate(geometry as Entity<GeometryComponent<EllipseData>>, transform);
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.translate: Unknown polygon data type ${(state as any).type}`,
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
          `GeometryComponent.equals: Unknown polygon data type ${(state as any).type}`,
        );
    }
  }

  export function resize(
    geometry: Entity<GeometryComponent>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): Entity<GeometryComponent> | null {
    const state = GeometryComponent.get(geometry);
    switch (state.type) {
      case 'polygon':
        return PolygonData.resize(
          geometry as Entity<GeometryComponent<PolygonData>>,
          params,
          originalBBox,
        );
      case 'rectangle':
        return RectangleData.resize(
          geometry as Entity<GeometryComponent<RectangleData>>,
          params,
          originalBBox,
        );
      case 'ellipse':
        return EllipseData.resize(
          geometry as Entity<GeometryComponent<EllipseData>>,
          params,
          originalBBox,
        );
      default:
        state satisfies never;
        throw new Error(
          `GeometryComponent.resize: Unknown polygon data type ${(state as any).type}`,
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
}
