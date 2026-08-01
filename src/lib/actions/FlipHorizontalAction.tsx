import { FlipHorizontal } from 'lucide-react';
import React from 'react';
import { Entity, GeometryComponent, type PolygonSegment } from '@/lib/entity';
import { EllipseData } from '@/lib/entity/geometry/ellipse';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { Flip } from '@/lib/math';
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
        const bbox = Entity.boundingBox(geometry);
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
        if (polyGeom) {
          const polyData = GeometryComponent.get(polyGeom);
          if (polyData.type === 'polygon') {
            geometryStore.updateById(id, (old) => {
              const data = GeometryComponent.get(old as Entity<GeometryComponent<PolygonData>>);
              return GeometryComponent.update(old as Entity<GeometryComponent<PolygonData>>, {
                points: flipPolygonPoints(data.points, centerX),
              });
            });
            continue;
          }

          if (polyData.type === 'rectangle') {
            const rect = polyData;
            const flippedUl = Flip.horizontal(rect.upperLeft, centerX);
            const flippedUr = Flip.horizontal(
              new SheetPosition(rect.lowerRight.x, rect.upperLeft.y),
              centerX,
            );
            const flippedLr = Flip.horizontal(rect.lowerRight, centerX);
            const flippedLl = Flip.horizontal(
              new SheetPosition(rect.upperLeft.x, rect.lowerRight.y),
              centerX,
            );

            const xs = [flippedUl.x, flippedUr.x, flippedLr.x, flippedLl.x];
            const ys = [flippedUl.y, flippedUr.y, flippedLr.y, flippedLl.y];
            const newUl = new SheetPosition(Math.min(...xs), Math.min(...ys));
            const newLr = new SheetPosition(Math.max(...xs), Math.max(...ys));

            geometryStore.updateById(id, (old) =>
              GeometryComponent.update(old as Entity<GeometryComponent<RectangleData>>, {
                upperLeft: newUl,
                lowerRight: newLr,
              }),
            );
            continue;
          }

          if (polyData.type === 'ellipse') {
            const ellipse = polyData;
            const newCenter = Flip.horizontal(ellipse.center, centerX);

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

function flipPolygonPoints(points: Array<PolygonSegment>, centerX: number): Array<PolygonSegment> {
  return points.map((seg) => {
    switch (seg.type) {
      case 'point':
        return {
          ...seg,
          point: Flip.horizontal(seg.point, centerX),
        };
      case 'arc-quadratic':
        return {
          ...seg,
          point: Flip.horizontal(seg.point, centerX),
          controlPoint: Flip.horizontal(seg.controlPoint, centerX),
        };
      case 'arc-cubic':
        return {
          ...seg,
          point: Flip.horizontal(seg.point, centerX),
          controlPointA: Flip.horizontal(seg.controlPointA, centerX),
          controlPointB: Flip.horizontal(seg.controlPointB, centerX),
        };
    }
  });
}
