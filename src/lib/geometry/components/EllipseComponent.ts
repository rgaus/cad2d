import { ellipsePoints } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Geometry, GeometryComponent } from '../types';

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
    return { for: 'ellipse' as const, center: ellipse.center, radiusX: ellipse.radiusX, radiusY: ellipse.radiusY };
  }
  export function setLayoutState<G extends Geometry<EllipseComponent>>(geometry: G, state: ReturnType<typeof getLayoutState>) {
    if (state.for !== 'ellipse') {
      return geometry;
    }
    return EllipseComponent.update(geometry, {
      center: state.center,
      radiusX: state.radiusX,
      radiusY: state.radiusY,
    });
  }
  export function transformLayoutState(state: ReturnType<typeof getLayoutState>, transform: (input: SheetPosition) => SheetPosition) {
    return transformOrigin(state, transform);
  }
  export function transformOrigin(state: ReturnType<typeof getLayoutState>, transform: (input: SheetPosition) => SheetPosition) {
    return { ...state, center: transform(state.center) };
  }
  export function layoutStateEqual(a: ReturnType<typeof getLayoutState>, b: ReturnType<typeof getLayoutState>) {
    if (a.for !== 'ellipse' || b.for !== 'ellipse') {
      return false;
    }
    return a.center.x === b.center.x && a.center.y === b.center.y;
  }
}
