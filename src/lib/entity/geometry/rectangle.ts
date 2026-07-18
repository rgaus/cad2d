import { BoundingBox } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { GeometryComponent } from '../components/GeometryComponent';
import { Entity, type ResizeParams } from '../types';

/** A rectangle shaped geometry represented by the axis aligned region between two points. */
export type RectangleData = {
  type: 'rectangle';
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
};

export namespace RectangleData {
  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Entity<GeometryComponent<RectangleData>>) {
    const rectangle = GeometryComponent.get(geometry);
    const rect: Rect<SheetPosition> = {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: BoundingBox.cornersToArray(BoundingBox.corners(rect)),
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
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
  }

  export function translate(
    geometry: Entity<GeometryComponent<RectangleData>>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    const state = GeometryComponent.get(geometry);
    const upperLeft = transform(state.upperLeft);
    return GeometryComponent.update(geometry, {
      upperLeft,
      lowerRight: new SheetPosition(
        // NOTE: keep width / height the same, even if that width/height doesn't nicely snap to a
        // grid
        upperLeft.x + (state.lowerRight.x - state.upperLeft.x),
        upperLeft.y + (state.lowerRight.y - state.upperLeft.y),
      ),
    });
  }

  export function getOrigin(geometry: Entity<GeometryComponent<RectangleData>>): SheetPosition {
    return GeometryComponent.get(geometry).upperLeft;
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
      aData.upperLeft.x === bData.upperLeft.x &&
      aData.upperLeft.y === bData.upperLeft.y &&
      aData.lowerRight.x === bData.lowerRight.x &&
      aData.lowerRight.y === bData.lowerRight.y
    );
  }

  export function resize(
    geometry: Entity<GeometryComponent<RectangleData>>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): Entity<GeometryComponent<RectangleData>> | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      originalBBox = {
        position: state.upperLeft,
        width: state.lowerRight.x - state.upperLeft.x,
        height: state.lowerRight.y - state.upperLeft.y,
      };
    }

    const newBBox = GeometryComponent.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }

    const pctLeft = (state.upperLeft.x - originalBBox.position.x) / originalBBox.width;
    const pctTop = (state.upperLeft.y - originalBBox.position.y) / originalBBox.height;
    const pctRight = (state.lowerRight.x - originalBBox.position.x) / originalBBox.width;
    const pctBottom = (state.lowerRight.y - originalBBox.position.y) / originalBBox.height;

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
      return GeometryComponent.update(geometry, { upperLeft: ul, lowerRight: lr });
    } else {
      return null;
    }
  }
}
