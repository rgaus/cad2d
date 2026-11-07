import { BoundingBox } from '@/lib/math';
import { KeyPoints, Rect, RectCorners, SheetPosition } from '@/lib/viewport/types';
import { GeometryComponent } from '../components/GeometryComponent';
import { Entity, type ResizeParams } from '../types';

/** A rectangle shaped geometry represented by the axis aligned region between two points. */
export type RectangleData = {
  type: 'rectangle';
  /** The position of the rectangle. By default, this is the upper left position unless
   * an {@link AnchorPointComponent} defines the origin differently. */
  origin: SheetPosition;
  width: number;
  height: number;
};

export namespace RectangleData {
  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Entity<GeometryComponent<RectangleData>>) {
    const rect = boundingBox(geometry);
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: cornersArray(GeometryComponent.get(geometry)),
      perimeterLabels: ['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft'] as const,
      extras: {
        center: new SheetPosition(
          rect.position.x + rect.width / 2,
          rect.position.y + rect.height / 2,
        ),
      },
    } satisfies KeyPoints<SheetPosition, string, string>;
  }

  export function boundingBox(
    geometry: Entity<GeometryComponent<RectangleData>>,
  ): Rect<SheetPosition> {
    const rectangle = GeometryComponent.get(geometry);
    return {
      position: rectangle.origin,
      width: rectangle.width,
      height: rectangle.height,
    };
  }

  export function corners(data: RectangleData): RectCorners<SheetPosition> {
    return BoundingBox.corners({
      position: data.origin,
      width: data.width,
      height: data.height,
    });
  }

  export function cornersArray(data: RectangleData): Array<SheetPosition> {
    return BoundingBox.cornersToArray(corners(data));
  }

  export function translate<E extends Entity<GeometryComponent<RectangleData>>>(
    geometry: E,
    transform: (input: SheetPosition) => SheetPosition,
  ): E {
    const state = GeometryComponent.get(geometry);
    return GeometryComponent.update(geometry, { origin: transform(state.origin) });
  }

  export function getOrigin(geometry: Entity<GeometryComponent<RectangleData>>): SheetPosition {
    return GeometryComponent.get(geometry).origin;
  }

  export function equals(
    a: Entity<GeometryComponent<RectangleData>>,
    b: Entity<GeometryComponent>,
  ) {
    const aData = GeometryComponent.get(a);
    const bData = GeometryComponent.get(b);
    if (bData.type !== 'rectangle') {
      return false;
    }
    return (
      aData.origin.x === bData.origin.x &&
      aData.origin.y === bData.origin.y &&
      aData.width === bData.width &&
      aData.height === bData.height
    );
  }

  export function resize<E extends Entity<GeometryComponent<RectangleData>>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      originalBBox = boundingBox(geometry);
    }

    const newBBox = GeometryComponent.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }

    const pctLeft = (state.origin.x - originalBBox.position.x) / originalBBox.width;
    const pctTop = (state.origin.y - originalBBox.position.y) / originalBBox.height;
    const pctRight = (state.origin.x + state.width - originalBBox.position.x) / originalBBox.width;
    const pctBottom =
      (state.origin.y + state.height - originalBBox.position.y) / originalBBox.height;

    const newUpperLeft = new SheetPosition(
      newBBox.position.x + pctLeft * newBBox.width,
      newBBox.position.y + pctTop * newBBox.height,
    );
    const newLowerRight = new SheetPosition(
      newBBox.position.x + pctRight * newBBox.width,
      newBBox.position.y + pctBottom * newBBox.height,
    );

    const ul = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lr = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );

    if (ul.x !== lr.x && ul.y !== lr.y) {
      return GeometryComponent.update(geometry, {
        origin: ul,
        width: lr.x - ul.x,
        height: lr.y - ul.y,
      });
    } else {
      return null;
    }
  }
}
