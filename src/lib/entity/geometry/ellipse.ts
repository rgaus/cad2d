import { ellipsePoints } from '@/lib/math';
import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { GeometryComponent } from '../components/GeometryComponent';
import { Entity, LayoutState, type ResizeParams } from '../types';

/** A elliptical shaped geometry represented by a point and x/y radius */
export type EllipseData = {
  type: 'ellipse';
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
};

export namespace EllipseData {
  /**
   * Key points that are added as verticies within the DCEL and available for a user to snap other
   * entities like constraints to.
   **/
  export function keyPoints(geometry: Entity<GeometryComponent<EllipseData>>) {
    const ellipse = GeometryComponent.get(geometry);
    const points = ellipsePoints(ellipse);
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: [points.top, points.right, points.bottom, points.left],
      perimeterLabels: ['top', 'right', 'bottom', 'left'] as const,
      extras: {
        center: points.center,
      },
    } satisfies KeyPoints<SheetPosition, string, string>;
  }

  export function boundingBox(
    geometry: Entity<GeometryComponent<EllipseData>>,
  ): Rect<SheetPosition> {
    const ellipse = GeometryComponent.get(geometry);
    return {
      position: new SheetPosition(
        ellipse.center.x - ellipse.radiusX,
        ellipse.center.y - ellipse.radiusY,
      ),
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  }

  export function translate(
    geometry: Entity<GeometryComponent<EllipseData>>,
    transform: (input: SheetPosition) => SheetPosition,
  ) {
    const { center } = GeometryComponent.get(geometry);
    return GeometryComponent.update(geometry, { center: transform(center) });
  }

  export function equals(a: Entity<GeometryComponent<EllipseData>>, b: Entity<GeometryComponent>) {
    const aData = GeometryComponent.get(a);
    const bData = GeometryComponent.get(b);
    if (bData.type !== 'ellipse') {
      return false;
    }
    return (
      aData.center.x === bData.center.x &&
      aData.center.y === bData.center.y &&
      aData.radiusX === bData.radiusX &&
      aData.radiusY === bData.radiusY
    );
  }

  export function resize(
    geometry: Entity<GeometryComponent<EllipseData>>,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): Entity<GeometryComponent<EllipseData>> | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      originalBBox = {
        position: new SheetPosition(state.center.x - state.radiusX, state.center.y - state.radiusY),
        width: state.radiusX * 2,
        height: state.radiusY * 2,
      };
    }

    const newBBox = LayoutState.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }

    const pctCenterX = (state.center.x - originalBBox.position.x) / originalBBox.width;
    const pctCenterY = (state.center.y - originalBBox.position.y) / originalBBox.height;
    const pctRadiusX = state.radiusX / originalBBox.width;
    const pctRadiusY = state.radiusY / originalBBox.height;

    const newCenter = new SheetPosition(
      newBBox.position.x + pctCenterX * newBBox.width,
      newBBox.position.y + pctCenterY * newBBox.height,
    );
    const newRadiusX = Math.abs(pctRadiusX * newBBox.width);
    const newRadiusY = Math.abs(pctRadiusY * newBBox.height);

    if (newRadiusX > 0 && newRadiusY > 0) {
      return GeometryComponent.update(geometry, {
        center: newCenter,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
      });
    }
    return null;
  }
}
