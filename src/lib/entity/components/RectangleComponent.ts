import { BoundingBox } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { Entity, EntityComponent, LayoutState, type ResizeParams } from '../types';
import { GeometryComponent } from './GeometryComponent';

/**
 * Geometry component containing rendering metadata about a rectangular shaped geometry.
 *
 * A component of Rectangle, but also could be used by other rectangular shaped geometries if
 * desired. */
export type RectangleComponent = EntityComponent<
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
    geometry: Entity<RectangleComponent>,
  ): RectangleComponent[keyof RectangleComponent] {
    return geometry.components.rectangle;
  }

  export function update<G extends Entity<RectangleComponent>>(
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
  export function keyPoints(geometry: Entity<RectangleComponent>) {
    const rectangle = RectangleComponent.get(geometry);
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

  export function boundingBox(geometry: Entity<RectangleComponent>): Rect<SheetPosition> {
    const rectangle = RectangleComponent.get(geometry);
    return {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
  }

  export function getLayoutState<G extends Entity<RectangleComponent>>(geometry: G) {
    const rectangle = RectangleComponent.get(geometry);
    return {
      for: 'rectangle' as const,
      upperLeft: rectangle.upperLeft,
      lowerRight: rectangle.lowerRight,
    };
  }
  export function setLayoutState<G extends Entity<RectangleComponent>>(
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
    originalBBox?: Rect<SheetPosition>,
  ): ReturnType<typeof getLayoutState> | null {
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
      return { for: 'rectangle' as const, upperLeft: ul, lowerRight: lr };
    }
    return null;
  }
}
