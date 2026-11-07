import { type UnitType } from '@/lib/units/length';
import { GeometryComponent } from '../components/GeometryComponent';
import { type PolygonSegment } from '../geometry/polygon';
import { RenderShape } from '../render-shape';
import { Entity } from '../types';

/** A rendered sheet-space path used by filter indicator overlays. */
export type IndicatorGeometryPath = {
  segments: Array<PolygonSegment>;
  closed: boolean;
};

/**
 * Returns the rendered (anchored + rotated) sheet-space paths of a geometry, for use by filter
 * indicator overlays. This deliberately uses the same render-shape pipeline as the canvas so the
 * indicator never mixes raw stored coordinates with rendered coordinates.
 */
export function getIndicatorGeometryPaths(
  geometry: Entity,
  sheetDefaultUnit: UnitType,
): Array<IndicatorGeometryPath> {
  if (!Entity.hasComponent(geometry, GeometryComponent)) {
    return [];
  }
  return GeometryComponent.getRenderShapes(geometry, sheetDefaultUnit).map((shape) => ({
    segments: RenderShape.toPolygonSegments(shape),
    closed: shape.shape === 'polygon' ? shape.closed : shape.shape !== 'point',
  }));
}
