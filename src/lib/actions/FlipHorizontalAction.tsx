import { FlipHorizontal } from 'lucide-react';
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

export class FlipHorizontalAction extends BaseAction {
  type = 'flip-horizontal' as const;
  label = 'Flip Horizontal';
  desc = 'Flips the selected geometry horizontally around the selection center.';
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return <FlipHorizontal size={20} />;
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

    const minX = Math.min(...bboxes.map((b) => b.position.x));
    const maxX = Math.max(...bboxes.map((b) => b.position.x + b.width));
    const centerX = (minX + maxX) / 2;

    historyManager.applyTransaction('flip-horizontal', () => {
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
                  Flip.horizontal(renderedPoint, centerX).toGeometryRelativeSheetPosition(
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
          const ux = Math.cos((angleDegrees * Math.PI) / 180);
          const uy = Math.sin((angleDegrees * Math.PI) / 180);
          const reflectedUx = -ux;
          const reflectedUy = uy;
          const reflectedOrigin = Flip.horizontal(render(polyData.origin), centerX);
          const rotatedAnchor = rotatePointAround(anchorOffset, new SheetPosition(0, 0), newAngle);
          const newOrigin = new SheetPosition(
            reflectedOrigin.x + reflectedUx * polyData.width + rotatedAnchor.x,
            reflectedOrigin.y + reflectedUy * polyData.width + rotatedAnchor.y,
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
          const reflectedCenter = Flip.horizontal(render(polyData.center), centerX);
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
