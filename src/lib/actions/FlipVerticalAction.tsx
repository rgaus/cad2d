import { FlipVertical } from 'lucide-react';
import React from 'react';
import {
  EllipseComponent,
  type Geometry,
  PolygonComponent,
  type PolygonSegment,
  RectangleComponent,
} from '@/lib/geometry';
import { flipPointVertically, geometryBoundingBox } from '@/lib/math';
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
      const geometry = geometryStore.getById(id);
      if (geometry) {
        const bbox = geometryBoundingBox(geometry);
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

    await historyManager.applyTransaction('flip-vertical', () => {
      for (const id of selectedIds) {
        const polygonGeom = geometryStore.getByIdWithComponent(id, PolygonComponent);
        if (polygonGeom) {
          geometryStore.updateById(id, () => ({
            ...polygonGeom,
            components: {
              ...polygonGeom.components,
              polygon: {
                ...polygonGeom.components.polygon,
                points: flipPolygonPoints(PolygonComponent.get(polygonGeom).points, centerY),
              },
            },
          }));
          continue;
        }

        const rectGeom = geometryStore.getByIdWithComponent(id, RectangleComponent);
        if (rectGeom) {
          const rect = RectangleComponent.get(rectGeom);
          const flippedUl = flipPointVertically(rect.upperLeft, centerY);
          const flippedUr = flipPointVertically(
            new SheetPosition(rect.lowerRight.x, rect.upperLeft.y),
            centerY,
          );
          const flippedLr = flipPointVertically(rect.lowerRight, centerY);
          const flippedLl = flipPointVertically(
            new SheetPosition(rect.upperLeft.x, rect.lowerRight.y),
            centerY,
          );

          const xs = [flippedUl.x, flippedUr.x, flippedLr.x, flippedLl.x];
          const ys = [flippedUl.y, flippedUr.y, flippedLr.y, flippedLl.y];
          const newUl = new SheetPosition(Math.min(...xs), Math.min(...ys));
          const newLr = new SheetPosition(Math.max(...xs), Math.max(...ys));

          geometryStore.updateById(id, () => ({
            ...rectGeom,
            components: {
              ...rectGeom.components,
              rectangle: {
                ...rectGeom.components.rectangle,
                upperLeft: newUl,
                lowerRight: newLr,
              },
            },
          }));
          continue;
        }

        const ellipseGeom = geometryStore.getByIdWithComponent(id, EllipseComponent);
        if (ellipseGeom) {
          const ellipse = EllipseComponent.get(ellipseGeom);
          const newCenter = flipPointVertically(ellipse.center, centerY);

          geometryStore.updateById(id, () => ({
            ...ellipseGeom,
            components: {
              ...ellipseGeom.components,
              ellipse: {
                ...ellipseGeom.components.ellipse,
                center: newCenter,
              },
            },
          }));
          continue;
        }
      }
    });
  }
}

function flipPolygonPoints(points: Array<PolygonSegment>, centerY: number): Array<PolygonSegment> {
  return points.map((seg) => {
    switch (seg.type) {
      case 'point':
        return {
          ...seg,
          point: flipPointVertically(seg.point, centerY),
        };
      case 'arc-quadratic':
        return {
          ...seg,
          point: flipPointVertically(seg.point, centerY),
          controlPoint: flipPointVertically(seg.controlPoint, centerY),
        };
      case 'arc-cubic':
        return {
          ...seg,
          point: flipPointVertically(seg.point, centerY),
          controlPointA: flipPointVertically(seg.controlPointA, centerY),
          controlPointB: flipPointVertically(seg.controlPointB, centerY),
        };
    }
  });
}
