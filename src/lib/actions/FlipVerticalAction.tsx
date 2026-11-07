import { FlipVertical } from 'lucide-react';
import React from 'react';
import { Entity, GeometryComponent } from '@/lib/entity';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { PolygonData, PolygonSegment } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { Flip, rotatePointAround } from '@/lib/math';
import { Angle } from '@/lib/units/angle';
import { type Rect, SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class FlipVerticalAction extends BaseAction {
  type = 'flip-vertical' as const;
  label = 'Flip Vertical';
  desc = 'Flips the selected geometry vertically around the selection center.';
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return <FlipVertical size={20} />;
  }

  constructor(actionsManager: ActionsManager) {
    super(actionsManager);

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
    this.disabled = this.getSelectionManager().isEmpty();
  }

  async execute() {
    const geometryStore = this.getGeometryStore();
    const selectionManager = this.getSelectionManager();
    const historyManager = this.getHistoryManager();
    const selectedIds = selectionManager.getSelectedIds();

    if (selectedIds.length === 0) {
      return;
    }

    // Compute collective bounding box center
    const bboxes: Array<Rect<SheetPosition>> = [];
    for (const id of selectedIds) {
      const geometry = geometryStore.getRenderableGeometryById(id);
      if (geometry) {
        const bbox = Entity.boundingBoxInSheet(geometry);
        if (bbox) {
          bboxes.push(bbox);
        }
      }
    }

    if (bboxes.length === 0) {
      return;
    }

    const minY = Math.min(...bboxes.map((b) => b.position.y));
    const maxY = Math.max(...bboxes.map((b) => b.position.y + b.height));
    const centerY = (minY + maxY) / 2;

    historyManager.applyTransaction('flip-vertical', () => {
      for (const id of selectedIds) {
        const polyGeom = geometryStore.getByIdWithComponent(id, GeometryComponent);
        if (!polyGeom) {
          continue;
        }
        const polyData = GeometryComponent.get(polyGeom);
        const angleDegrees =
          RotationComponent.getOptional(polyGeom)?.angle.toDegrees().magnitude ?? 0;
        const anchorOffset = GeometryComponent.getAnchorPointOffset(polyGeom);
        const render = Entity.generateRenderTransformFunction(polyGeom);

        if (polyData.type === 'polygon') {
          geometryStore.updateById(id, (old) => {
            const rendered = PolygonData.renderedSegments(
              old as Entity<GeometryComponent<PolygonData>>,
            );
            // Reflect the rendered outline, then map it back through the geometry's full render
            // transform (anchor + rotation) so the stored raw points stay in the local frame.
            return GeometryComponent.update(old as Entity<GeometryComponent<PolygonData>>, {
              points: rendered.map((segment) =>
                PolygonSegment.transform(segment, (renderedPoint) =>
                  Flip.vertical(renderedPoint, centerY).toGeometryRelativeSheetPosition(
                    old as Entity<GeometryComponent>,
                  ),
                ),
              ),
            });
          });
          continue;
        }

        if (polyData.type === 'rectangle') {
          // A reflection reverses the local frame. Rotating by the negated angle restores the
          // reflected orientation, and shifting the raw origin to the reflected corner keeps the
          // rendered rectangle in place.
          const newAngle = -angleDegrees;
          const vx = -Math.sin((angleDegrees * Math.PI) / 180);
          const vy = Math.cos((angleDegrees * Math.PI) / 180);
          const reflectedVx = vx;
          const reflectedVy = -vy;
          const reflectedOrigin = Flip.vertical(render(polyData.origin), centerY);
          const rotatedAnchor = rotatePointAround(anchorOffset, new SheetPosition(0, 0), newAngle);
          const newOrigin = new SheetPosition(
            reflectedOrigin.x + reflectedVx * polyData.height + rotatedAnchor.x,
            reflectedOrigin.y + reflectedVy * polyData.height + rotatedAnchor.y,
          );

          geometryStore.updateById(id, (old) => {
            const updated = GeometryComponent.update(
              old as Entity<GeometryComponent<RectangleData>>,
              {
                origin: newOrigin,
                width: polyData.width,
                height: polyData.height,
              },
            );
            if (!Entity.hasComponent(updated, RotationComponent)) {
              return updated;
            }
            return RotationComponent.update(updated as Entity<RotationComponent>, {
              angle: Angle.degrees(newAngle),
            });
          });
          continue;
        }

        if (polyData.type === 'ellipse') {
          const newAngle = -angleDegrees;
          const reflectedCenter = Flip.vertical(render(polyData.center), centerY);
          const rotatedAnchor = rotatePointAround(anchorOffset, new SheetPosition(0, 0), newAngle);
          const newCenter = new SheetPosition(
            reflectedCenter.x + rotatedAnchor.x,
            reflectedCenter.y + rotatedAnchor.y,
          );

          geometryStore.updateById(id, (old) => {
            const updated = GeometryComponent.update(
              old as Entity<GeometryComponent<EllipseData>>,
              {
                center: newCenter,
              },
            );
            if (!Entity.hasComponent(updated, RotationComponent)) {
              return updated;
            }
            return RotationComponent.update(updated as Entity<RotationComponent>, {
              angle: Angle.degrees(newAngle),
            });
          });
          continue;
        }
      }
    });
  }
}
