import { ellipsePoints } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Geometry, GeometryComponent, type ResizeParams } from '../types';

/**
 * Geometry component containing rendering metadata about an elliptical shaped geometry.
 *
 * A component of Ellipse, but also could be used by other elliptical shaped geometries if
 * desired. */
export type EllipseComponent = GeometryComponent<
  'ellipse',
  {
    center: SheetPosition;
    radiusX: number;
    radiusY: number;
  }
>;

export namespace EllipseComponent {
  export const key: keyof EllipseComponent = 'ellipse';

  export function create(
    center: SheetPosition,
    args: { radiusX: number; radiusY: number },
  ): EllipseComponent {
    return {
      ellipse: { center, radiusX: args.radiusX, radiusY: args.radiusY },
    };
  }

  export function get(
    geometry: Geometry<EllipseComponent>,
  ): EllipseComponent[keyof EllipseComponent] {
    return geometry.components.ellipse;
  }

  export function update<G extends Geometry<EllipseComponent>>(
    geometry: G,
    ellipse: Partial<EllipseComponent[keyof EllipseComponent]>,
  ): G {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        ellipse: { ...geometry.components.ellipse, ...ellipse },
      },
    };
  }

  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(
    geometry: Geometry<EllipseComponent>,
  ): KeyPoints<SheetPosition, 'center'> {
    const ellipse = EllipseComponent.get(geometry);
    const points = ellipsePoints(ellipse);
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: [points.top, points.right, points.bottom, points.left],

      extras: {
        center: points.center,
      },
    };
  }

  export function boundingBox(geometry: Geometry<EllipseComponent>): Rect<SheetPosition> {
    const ellipse = EllipseComponent.get(geometry);
    return {
      position: new SheetPosition(
        ellipse.center.x - ellipse.radiusX,
        ellipse.center.y - ellipse.radiusY,
      ),
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  }

  export function getLayoutState<G extends Geometry<EllipseComponent>>(geometry: G) {
    const ellipse = EllipseComponent.get(geometry);
    return {
      for: 'ellipse' as const,
      center: ellipse.center,
      radiusX: ellipse.radiusX,
      radiusY: ellipse.radiusY,
    };
  }
  export function setLayoutState<G extends Geometry<EllipseComponent>>(
    geometry: G,
    state: ReturnType<typeof getLayoutState>,
  ) {
    if (state.for !== 'ellipse') {
      return geometry;
    }
    return EllipseComponent.update(geometry, {
      center: state.center,
      radiusX: state.radiusX,
      radiusY: state.radiusY,
    });
  }
  export function layoutStateTranslate(
    state: ReturnType<typeof getLayoutState>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    return { ...state, center: transform(state.center) };
  }
  export function layoutStateEqual(
    a: ReturnType<typeof getLayoutState>,
    b: ReturnType<typeof getLayoutState>,
  ) {
    if (a.for !== 'ellipse' || b.for !== 'ellipse') {
      return false;
    }
    return a.center.x === b.center.x && a.center.y === b.center.y;
  }

  export function layoutStateResize(
    state: ReturnType<typeof getLayoutState>,
    params: ResizeParams,
  ): ReturnType<typeof getLayoutState> | null {
    const originalCenter = state.center;
    const originalRadiusX = state.radiusX;
    const originalRadiusY = state.radiusY;

    let newCenter = originalCenter;
    let newRadiusX = originalRadiusX;
    let newRadiusY = originalRadiusY;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;

      if (params.altHeld) {
        let dx: number;
        let dy: number;
        switch (corner) {
          case 'top-left':
            dx = originalCenter.x - params.to.x;
            dy = originalCenter.y - params.to.y;
            break;
          case 'top-right':
            dx = params.to.x - originalCenter.x;
            dy = originalCenter.y - params.to.y;
            break;
          case 'bottom-left':
            dx = originalCenter.x - params.to.x;
            dy = params.to.y - originalCenter.y;
            break;
          case 'bottom-right':
            dx = params.to.x - originalCenter.x;
            dy = params.to.y - originalCenter.y;
            break;
        }
        newRadiusX = Math.abs(dx);
        newRadiusY = Math.abs(dy);
      } else {
        switch (corner) {
          case 'top-left': {
            const originalLowerRightX = originalCenter.x + originalRadiusX;
            const originalLowerRightY = originalCenter.y + originalRadiusY;
            newRadiusX = (originalLowerRightX - params.to.x) / 2;
            newRadiusY = (originalLowerRightY - params.to.y) / 2;
            newCenter = new SheetPosition(
              originalLowerRightX - newRadiusX,
              originalLowerRightY - newRadiusY,
            );
            break;
          }
          case 'top-right': {
            const originalBottomLeftX = originalCenter.x - originalRadiusX;
            const originalBottomLeftY = originalCenter.y + originalRadiusY;
            newRadiusX = (params.to.x - originalBottomLeftX) / 2;
            newRadiusY = (originalBottomLeftY - params.to.y) / 2;
            newCenter = new SheetPosition(
              originalBottomLeftX + newRadiusX,
              originalBottomLeftY - newRadiusY,
            );
            break;
          }
          case 'bottom-left': {
            const originalTopRightX = originalCenter.x + originalRadiusX;
            const originalTopRightY = originalCenter.y - originalRadiusY;
            newRadiusX = (originalTopRightX - params.to.x) / 2;
            newRadiusY = (params.to.y - originalTopRightY) / 2;
            newCenter = new SheetPosition(
              originalTopRightX - newRadiusX,
              originalTopRightY + newRadiusY,
            );
            break;
          }
          case 'bottom-right': {
            const originalTopLeftX = originalCenter.x - originalRadiusX;
            const originalTopLeftY = originalCenter.y - originalRadiusY;
            newRadiusX = (params.to.x - originalTopLeftX) / 2;
            newRadiusY = (params.to.y - originalTopLeftY) / 2;
            newCenter = new SheetPosition(
              originalTopLeftX + newRadiusX,
              originalTopLeftY + newRadiusY,
            );
            break;
          }
        }
      }

      if (params.superHeld || params.linkDimensions) {
        const dist = Math.max(newRadiusX, newRadiusY);
        const signX = newRadiusX >= 0 ? 1 : -1;
        const signY = newRadiusY >= 0 ? 1 : -1;
        const uniformRadiusX = signX * dist;
        const uniformRadiusY = signY * dist;
        if (params.altHeld) {
          newRadiusX = uniformRadiusX;
          newRadiusY = uniformRadiusY;
        } else {
          switch (corner) {
            case 'top-left':
              newCenter = new SheetPosition(
                newCenter.x - (uniformRadiusX - newRadiusX),
                newCenter.y - (uniformRadiusY - newRadiusY),
              );
              newRadiusX = uniformRadiusX;
              newRadiusY = uniformRadiusY;
              break;
            case 'top-right':
              newCenter = new SheetPosition(
                newCenter.x + (uniformRadiusX - newRadiusX),
                newCenter.y - (uniformRadiusY - newRadiusY),
              );
              newRadiusX = uniformRadiusX;
              newRadiusY = uniformRadiusY;
              break;
            case 'bottom-left':
              newCenter = new SheetPosition(
                newCenter.x - (uniformRadiusX - newRadiusX),
                newCenter.y + (uniformRadiusY - newRadiusY),
              );
              newRadiusX = uniformRadiusX;
              newRadiusY = uniformRadiusY;
              break;
            case 'bottom-right':
              newCenter = new SheetPosition(
                newCenter.x + (uniformRadiusX - newRadiusX),
                newCenter.y + (uniformRadiusY - newRadiusY),
              );
              newRadiusX = uniformRadiusX;
              newRadiusY = uniformRadiusY;
              break;
          }
        }
      }
    } else {
      const edge = params.mode.edge;

      if (params.altHeld) {
        switch (edge) {
          case 'top':
            newRadiusY = Math.abs(originalCenter.y - params.to.y);
            if (params.linkDimensions) {
              newRadiusX = originalRadiusX * (newRadiusY / originalRadiusX);
            }
            break;
          case 'right':
            newRadiusX = Math.abs(params.to.x - originalCenter.x);
            if (params.linkDimensions) {
              newRadiusY = originalRadiusY * (newRadiusX / originalRadiusY);
            }
            break;
          case 'left':
            newRadiusX = Math.abs(originalCenter.x - params.to.x);
            if (params.linkDimensions) {
              newRadiusY = originalRadiusY * (newRadiusX / originalRadiusY);
            }
            break;
          case 'bottom':
            newRadiusY = Math.abs(params.to.y - originalCenter.y);
            if (params.linkDimensions) {
              newRadiusX = originalRadiusX * (newRadiusY / originalRadiusX);
            }
            break;
        }
      } else {
        switch (edge) {
          case 'top': {
            const originalBottomY = originalCenter.y + originalRadiusY;
            newRadiusY = (originalBottomY - params.to.y) / 2;
            newCenter = new SheetPosition(newCenter.x, originalBottomY - newRadiusY);
            if (params.linkDimensions) {
              newRadiusX = originalRadiusX * (newRadiusY / originalRadiusX);
            }
            break;
          }
          case 'right': {
            const originalLeftX = originalCenter.x - originalRadiusX;
            newRadiusX = (params.to.x - originalLeftX) / 2;
            newCenter = new SheetPosition(originalLeftX + newRadiusX, newCenter.y);
            if (params.linkDimensions) {
              newRadiusY = originalRadiusY * (newRadiusX / originalRadiusY);
            }
            break;
          }
          case 'left': {
            const originalRightX = originalCenter.x + originalRadiusX;
            newRadiusX = (originalRightX - params.to.x) / 2;
            newCenter = new SheetPosition(originalRightX - newRadiusX, newCenter.y);
            if (params.linkDimensions) {
              newRadiusY = originalRadiusY * (newRadiusX / originalRadiusY);
            }
            break;
          }
          case 'bottom': {
            const originalTopY = originalCenter.y - originalRadiusY;
            newRadiusY = (params.to.y - originalTopY) / 2;
            newCenter = new SheetPosition(newCenter.x, originalTopY + newRadiusY);
            if (params.linkDimensions) {
              newRadiusX = originalRadiusX * (newRadiusY / originalRadiusX);
            }
            break;
          }
        }
      }
    }

    if (newRadiusX > 0 && newRadiusY > 0) {
      return {
        for: 'ellipse' as const,
        center: newCenter,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
      };
    }
    return null;
  }
}
