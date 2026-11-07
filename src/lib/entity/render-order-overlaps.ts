import { BoundingBox } from '@/lib/math';
import { GeometryStore } from './GeometryStore';
import { FillColorComponent } from './components/FillColorComponent';
import { RenderOrderComponent } from './components/RenderOrderComponent';
import { Entity, type Id } from './types';

export type RenderOrderOverlap = {
  id: Id;
  renderOrder: number;
  color: string;
};

/** Finds renderable geometries whose rendered sheet-space bounds overlap the given geometry. */
export function findRenderOrderOverlaps(
  geometryStore: GeometryStore,
  geometryId: Id,
): Array<RenderOrderOverlap> {
  const geometry = geometryStore.getRenderableGeometryById(geometryId);
  if (!geometry) {
    return [];
  }
  const bounds = Entity.boundingBoxInSheet(geometry);

  const results: Array<RenderOrderOverlap> = [];
  for (const other of geometryStore.listRenderableGeometries()) {
    if (other.id === geometry.id) {
      continue;
    }
    const otherBounds = Entity.boundingBoxInSheet(other);
    const otherRenderOrder = Entity.hasComponent(other, RenderOrderComponent)
      ? RenderOrderComponent.get(other)
      : null;
    const otherFillColor = FillColorComponent.getOptional(other);
    if (
      BoundingBox.intersects(bounds, otherBounds) &&
      otherFillColor !== null &&
      otherRenderOrder !== null
    ) {
      results.push({
        id: other.id,
        renderOrder: otherRenderOrder,
        color: `#${otherFillColor?.toString(16)}`,
      });
    }
  }
  return results;
}
