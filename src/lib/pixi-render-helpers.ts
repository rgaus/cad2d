import type { Graphics } from 'pixi.js';
import { PolygonSegment } from '@/lib/entity';
import { ellipseToPolygon, rotatePointAround } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';

/** Appends a closed path built from sheet-space polygon segments to the given graphics. */
function appendClosedPath(graphics: Graphics, segments: Array<PolygonSegment>) {
  const first = segments[0];
  if (!first) {
    return;
  }
  graphics.moveTo(first.point.x * SHEET_UNITS_TO_PIXELS, first.point.y * SHEET_UNITS_TO_PIXELS);
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    switch (seg.type) {
      case 'point':
        graphics.lineTo(seg.point.x * SHEET_UNITS_TO_PIXELS, seg.point.y * SHEET_UNITS_TO_PIXELS);
        break;
      case 'arc-quadratic':
        graphics.quadraticCurveTo(
          seg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
          seg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
          seg.point.x * SHEET_UNITS_TO_PIXELS,
          seg.point.y * SHEET_UNITS_TO_PIXELS,
        );
        break;
      case 'arc-cubic':
        graphics.bezierCurveTo(
          seg.controlPointA.x * SHEET_UNITS_TO_PIXELS,
          seg.controlPointA.y * SHEET_UNITS_TO_PIXELS,
          seg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
          seg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
          seg.point.x * SHEET_UNITS_TO_PIXELS,
          seg.point.y * SHEET_UNITS_TO_PIXELS,
        );
        break;
      default:
        seg satisfies never;
        break;
    }
  }
  graphics.closePath();
}

/** Appends a rectangle to the given graphics, rotating its corners around its upper-left corner.
 * Callers are responsible for filling / stroking the resulting path. */
export function drawRotatedRectangle(
  graphics: Graphics,
  upperLeft: SheetPosition,
  lowerRight: SheetPosition,
  angleDegrees: number = 0,
) {
  if (angleDegrees === 0) {
    graphics.rect(
      upperLeft.x * SHEET_UNITS_TO_PIXELS,
      upperLeft.y * SHEET_UNITS_TO_PIXELS,
      (lowerRight.x - upperLeft.x) * SHEET_UNITS_TO_PIXELS,
      (lowerRight.y - upperLeft.y) * SHEET_UNITS_TO_PIXELS,
    );
    return;
  }

  const segments: Array<PolygonSegment> = [
    upperLeft,
    new SheetPosition(lowerRight.x, upperLeft.y),
    lowerRight,
    new SheetPosition(upperLeft.x, lowerRight.y),
  ].map((point) => ({
    type: 'point',
    point: rotatePointAround(point, upperLeft, angleDegrees),
  }));
  appendClosedPath(graphics, segments);
}

/** Appends an ellipse to the given graphics, rotating it around its center. Callers are
 * responsible for filling / stroking the resulting path. */
export function drawRotatedEllipse(
  graphics: Graphics,
  center: SheetPosition,
  radiusX: number,
  radiusY: number,
  angleDegrees: number = 0,
) {
  if (angleDegrees === 0) {
    graphics.ellipse(
      center.x * SHEET_UNITS_TO_PIXELS,
      center.y * SHEET_UNITS_TO_PIXELS,
      radiusX * SHEET_UNITS_TO_PIXELS,
      radiusY * SHEET_UNITS_TO_PIXELS,
    );
    return;
  }

  const segments = ellipseToPolygon(center, radiusX, radiusY).map((seg) =>
    PolygonSegment.transform(seg, (point) => rotatePointAround(point, center, angleDegrees)),
  );
  appendClosedPath(graphics, segments);
}
