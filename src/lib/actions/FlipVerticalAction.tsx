import { FlipVertical } from 'lucide-react';
import React from 'react';
import { Entity, GeometryComponent } from '@/lib/entity';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { PolygonData, PolygonSegment } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { Flip } from '@/lib/math';
import { GeometryRelativeSheetPosition, type Rect, SheetPosition } from '@/lib/viewport/types';
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
        if (polyGeom) {
          const polyData = GeometryComponent.get(polyGeom);
          // The selection center is in anchored space; geometry is stored raw.
          const rawCenterY = centerY + GeometryComponent.getAnchorPointOffset(polyGeom).y;
          if (polyData.type === 'polygon') {
            geometryStore.updateById(id, (old) => {
              const data = GeometryComponent.get(old as Entity<GeometryComponent<PolygonData>>);
              const position = data.position;
              return GeometryComponent.update(old as Entity<GeometryComponent<PolygonData>>, {
                points: data.points.map((segment) =>
                  PolygonSegment.transform(segment, (local) => {
                    const absolute = new SheetPosition(position.x + local.x, position.y + local.y);
                    const flipped = Flip.vertical(absolute, rawCenterY);
                    return new GeometryRelativeSheetPosition(
                      flipped.x - position.x,
                      flipped.y - position.y,
                    );
                  }),
                ),
              });
            });
            continue;
          }

          if (polyData.type === 'rectangle') {
            const corners = RectangleData.corners(polyData);
            const flippedUl = Flip.vertical(corners.upperLeft, rawCenterY);
            const flippedUr = Flip.vertical(corners.upperRight, rawCenterY);
            const flippedLr = Flip.vertical(corners.lowerRight, rawCenterY);
            const flippedLl = Flip.vertical(corners.lowerLeft, rawCenterY);

            const xs = [flippedUl.x, flippedUr.x, flippedLr.x, flippedLl.x];
            const ys = [flippedUl.y, flippedUr.y, flippedLr.y, flippedLl.y];
            const newUl = new SheetPosition(Math.min(...xs), Math.min(...ys));
            const newLr = new SheetPosition(Math.max(...xs), Math.max(...ys));

            geometryStore.updateById(id, (old) =>
              GeometryComponent.update(old as Entity<GeometryComponent<RectangleData>>, {
                origin: newUl,
                width: newLr.x - newUl.x,
                height: newLr.y - newUl.y,
              }),
            );
            continue;
          }

          if (polyData.type === 'ellipse') {
            const ellipse = polyData;
            const newCenter = Flip.vertical(ellipse.center, rawCenterY);

            geometryStore.updateById(id, (old) =>
              GeometryComponent.update(old as Entity<GeometryComponent<EllipseData>>, {
                center: newCenter,
              }),
            );
            continue;
          }
        }
      }
    });
  }
}
