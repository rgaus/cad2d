import { cornersToList, rectCorners } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Geometry, GeometryComponent } from '../types';

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
}
