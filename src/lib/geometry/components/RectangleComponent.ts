import { cornersToList, rectCorners } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import {
  Geometry,
  GeometryComponent,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeMode,
  type ResizeParams,
} from '../types';

/**
 * Geometry component containing rendering metadata about a rectangular shaped geometry.
 *
 * A component of Rectangle, but also could be used by other rectangular shaped geometries if
 * desired. */
export type RectangleComponent = GeometryComponent<
  'rectangle',
  {
    upperLeft: SheetPosition;
    lowerRight: SheetPosition;
  }
>;

export namespace RectangleComponent {
  export const key: keyof RectangleComponent = 'rectangle';

  export function create(upperLeft: SheetPosition, lowerRight: SheetPosition): RectangleComponent {
    return {
      rectangle: { upperLeft, lowerRight },
    };
  }

  export function get(
    geometry: Geometry<RectangleComponent>,
  ): RectangleComponent[keyof RectangleComponent] {
    return geometry.components.rectangle;
  }

  export function update<G extends Geometry<RectangleComponent>>(
    geometry: G,
    rectangle: Partial<RectangleComponent[keyof RectangleComponent]>,
  ): G {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        rectangle: { ...geometry.components.rectangle, ...rectangle },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(
    geometry: Geometry<RectangleComponent>,
  ): KeyPoints<SheetPosition, never> {
    const rectangle = RectangleComponent.get(geometry);
    const rect: Rect<SheetPosition> = {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: cornersToList(rectCorners(rect)),
      extras: {},
    };
  }

  export function boundingBox(geometry: Geometry<RectangleComponent>): Rect<SheetPosition> {
    const rectangle = RectangleComponent.get(geometry);
    return {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
  }

  export function getLayoutState<G extends Geometry<RectangleComponent>>(geometry: G) {
    const rectangle = RectangleComponent.get(geometry);
    return {
      for: 'rectangle' as const,
      upperLeft: rectangle.upperLeft,
      lowerRight: rectangle.lowerRight,
    };
  }
  export function setLayoutState<G extends Geometry<RectangleComponent>>(
    geometry: G,
    state: ReturnType<typeof getLayoutState>,
  ) {
    if (state.for !== 'rectangle') {
      return geometry;
    }
    return RectangleComponent.update(geometry, {
      upperLeft: state.upperLeft,
      lowerRight: state.lowerRight,
    });
  }

  export function layoutStateTranslate(
    state: ReturnType<typeof getLayoutState>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    const upperLeft = transform(state.upperLeft);
    return {
      ...state,
      upperLeft,
      lowerRight: new SheetPosition(
        // NOTE: keep width / height the same, even if that width/height doesn't nicely snap to a
        // grid
        upperLeft.x + (state.lowerRight.x - state.upperLeft.x),
        upperLeft.y + (state.lowerRight.y - state.upperLeft.y),
      ),
    };
  }

  export function layoutStateEqual(
    a: ReturnType<typeof getLayoutState>,
    b: ReturnType<typeof getLayoutState>,
  ) {
    if (a.for !== 'rectangle' || b.for !== 'rectangle') {
      return false;
    }
    return (
      a.upperLeft.x === b.upperLeft.x &&
      a.upperLeft.y === b.upperLeft.y &&
      a.lowerRight.x === b.lowerRight.x &&
      a.lowerRight.y === b.lowerRight.y
    );
  }

  export function layoutStateResize(
    state: ReturnType<typeof getLayoutState>,
    params: ResizeParams,
  ): ReturnType<typeof getLayoutState> | null {
    const originalUpperLeft = state.upperLeft;
    const originalLowerRight = state.lowerRight;

    let newUpperLeft = originalUpperLeft;
    let newLowerRight = originalLowerRight;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;
      const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
      const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;

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
            newUpperLeft = new SheetPosition(originalUpperLeft.x, params.to.y);
            newLowerRight = new SheetPosition(params.to.x, originalLowerRight.y);
            break;
          case 'bottom-left':
            newUpperLeft = new SheetPosition(params.to.x, originalUpperLeft.y);
            newLowerRight = new SheetPosition(originalLowerRight.x, params.to.y);
            break;
          case 'bottom-right':
            newLowerRight = params.to;
            break;
        }
      }

      if (params.superHeld || params.linkDimensions) {
        const width = newLowerRight.x - newUpperLeft.x;
        const height = newLowerRight.y - newUpperLeft.y;
        const size = Math.max(Math.abs(width), Math.abs(height));
        const signX = width >= 0 ? 1 : -1;
        const signY = height >= 0 ? 1 : -1;
        const newWidth = signX * size;
        const newHeight = signY * size;
        if (params.altHeld) {
          newUpperLeft = new SheetPosition(centerX - newWidth / 2, centerY - newHeight / 2);
          newLowerRight = new SheetPosition(centerX + newWidth / 2, centerY + newHeight / 2);
        } else {
          switch (corner) {
            case 'top-left':
            case 'bottom-left':
              newUpperLeft = new SheetPosition(newLowerRight.x - size, newUpperLeft.y);
              break;
            case 'top-right':
            case 'bottom-right':
              newLowerRight = new SheetPosition(newUpperLeft.x + size, newLowerRight.y);
              break;
          }
          switch (corner) {
            case 'top-left':
            case 'top-right':
              newUpperLeft = new SheetPosition(newUpperLeft.x, newLowerRight.y - size);
              break;
            case 'bottom-left':
            case 'bottom-right':
              newLowerRight = new SheetPosition(newLowerRight.x, newUpperLeft.y + size);
              break;
          }
        }
      }
    } else {
      const edge = params.mode.edge;
      const originalWidth = originalLowerRight.x - originalUpperLeft.x;
      const originalHeight = originalLowerRight.y - originalUpperLeft.y;

      if (params.altHeld) {
        const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
        const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
        const halfWidth = originalWidth / 2;
        const halfHeight = originalHeight / 2;

        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(centerX - halfWidth, params.to.y);
            newLowerRight = new SheetPosition(
              centerX + halfWidth,
              centerY + halfHeight + (originalUpperLeft.y - params.to.y),
            );
            if (params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'bottom':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth,
              centerY - halfHeight - (params.to.y - originalLowerRight.y),
            );
            newLowerRight = new SheetPosition(centerX + halfWidth, params.to.y);
            if (params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, centerY - halfHeight);
            newLowerRight = new SheetPosition(
              centerX + halfWidth + (originalUpperLeft.x - params.to.x),
              centerY + halfHeight,
            );
            if (params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth - (params.to.x - originalLowerRight.x),
              centerY - halfHeight,
            );
            newLowerRight = new SheetPosition(params.to.x, centerY + halfHeight);
            if (params.linkDimensions) {
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
            newUpperLeft = new SheetPosition(originalUpperLeft.x, params.to.y);
            if (params.linkDimensions) {
              const delta = originalUpperLeft.y - params.to.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, params.to.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, originalLowerRight.y);
            }
            break;
          case 'bottom':
            newLowerRight = new SheetPosition(originalLowerRight.x, params.to.y);
            if (params.linkDimensions) {
              const delta = params.to.y - originalLowerRight.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (originalUpperLeft.x + originalLowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, originalUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, params.to.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, originalUpperLeft.y);
            if (params.linkDimensions) {
              const delta = originalUpperLeft.x - params.to.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
              newUpperLeft = new SheetPosition(params.to.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(originalLowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newLowerRight = new SheetPosition(params.to.x, originalLowerRight.y);
            if (params.linkDimensions) {
              const delta = params.to.x - originalLowerRight.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (originalUpperLeft.y + originalLowerRight.y) / 2;
              newUpperLeft = new SheetPosition(originalUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(params.to.x, centerY + newHeight / 2);
            }
            break;
        }
      }
    }

    const upperLeft = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lowerRight = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );

    if (upperLeft.x !== lowerRight.x && upperLeft.y !== lowerRight.y) {
      return { for: 'rectangle' as const, upperLeft, lowerRight };
    }
    return null;
  }
}
