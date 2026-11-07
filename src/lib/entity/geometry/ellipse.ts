import { ellipsePoints } from '@/lib/math';
import {
  GeometryRelativeSheetPosition,
  KeyPoints,
  OrientedRect,
  Rect,
  SheetPosition,
} from '@/lib/viewport/types';
import { GeometryComponent } from '../components/GeometryComponent';
import { Entity, type ResizeParams } from '../types';

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
  export function rawKeyPoints(geometry: Entity<GeometryComponent<EllipseData>>) {
    const ellipse = GeometryComponent.get(geometry);
    const points = ellipsePoints(ellipse);
    const toRelative = (position: SheetPosition) =>
      GeometryRelativeSheetPosition.fromRawSheet(position, geometry);
    return {
      // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
      // expects.
      perimeter: [points.top, points.right, points.bottom, points.left].map(toRelative),
      perimeterLabels: ['top', 'right', 'bottom', 'left'] as const,
      extras: {
        center: toRelative(points.center),
      },
    } satisfies KeyPoints<GeometryRelativeSheetPosition, string, string>;
  }

  export function boundingBox(
    geometry: Entity<GeometryComponent<EllipseData>>,
  ): Rect<GeometryRelativeSheetPosition> {
    const ellipse = GeometryComponent.get(geometry);
    return {
      position: new GeometryRelativeSheetPosition(-ellipse.radiusX, -ellipse.radiusY),
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  }

  /** Oriented bounding box in geometry-relative coordinates. */
  export function orientedBoundingBox(
    data: EllipseData,
    angleDegrees: number,
  ): OrientedRect<GeometryRelativeSheetPosition> {
    return {
      position: new GeometryRelativeSheetPosition(-data.radiusX, -data.radiusY),
      width: data.radiusX * 2,
      height: data.radiusY * 2,
      angleDegrees,
    };
  }

  export function translate<E extends Entity<GeometryComponent<EllipseData>>>(
    geometry: E,
    transform: (input: SheetPosition) => SheetPosition,
  ): E {
    const { center } = GeometryComponent.get(geometry);
    return GeometryComponent.update(geometry, { center: transform(center) });
  }

  export function getOrigin(geometry: Entity<GeometryComponent<EllipseData>>): SheetPosition {
    return GeometryComponent.get(geometry).center;
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

  export function resize<E extends Entity<GeometryComponent<EllipseData>>>(
    geometry: E,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): E | null {
    const state = GeometryComponent.get(geometry);
    if (!originalBBox) {
      originalBBox = {
        position: new SheetPosition(state.center.x - state.radiusX, state.center.y - state.radiusY),
        width: state.radiusX * 2,
        height: state.radiusY * 2,
      };
    }
    if (!GeometryComponent.isValidResizeBBox(originalBBox)) {
      return null;
    }

    const newBBox = GeometryComponent.resizeBBox(originalBBox, params);
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

    if (
      Number.isFinite(newCenter.x) &&
      Number.isFinite(newCenter.y) &&
      Number.isFinite(newRadiusX) &&
      Number.isFinite(newRadiusY) &&
      newRadiusX > 0 &&
      newRadiusY > 0
    ) {
      return GeometryComponent.update(geometry, {
        center: newCenter,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
      });
    }
    return null;
  }
}
