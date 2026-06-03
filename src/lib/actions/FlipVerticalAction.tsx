import { FlipVertical } from 'lucide-react';
import React from 'react';
import { type PolygonSegment } from '@/lib/geometry';
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
      const polygon = geometryStore.getPolygonById(id);
      if (polygon) {
        const bbox = geometryBoundingBox(polygon);
        if (bbox) {
          bboxes.push(bbox);
        }
        continue;
      }
      const rect = geometryStore.getRectangleById(id);
      if (rect) {
        const bbox = geometryBoundingBox(rect);
        if (bbox) {
          bboxes.push(bbox);
        }
        continue;
      }
      const ellipse = geometryStore.getEllipseById(id);
      if (ellipse) {
        const bbox = geometryBoundingBox(ellipse);
        if (bbox) {
          bboxes.push(bbox);
        }
        continue;
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
        const polygon = geometryStore.getPolygonById(id);
        if (polygon) {
          geometryStore.updatePolygon(id, (old) => ({
            ...old,
            points: flipPolygonPoints(old.points, centerY),
          }));
          continue;
        }

        const rect = geometryStore.getRectangleById(id);
        if (rect) {
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

          geometryStore.updateRectangle(id, {
            upperLeft: newUl,
            lowerRight: newLr,
          });
          continue;
        }

        const ellipse = geometryStore.getEllipseById(id);
        if (ellipse) {
          const newCenter = flipPointVertically(ellipse.center, centerY);
          geometryStore.updateEllipse(id, { center: newCenter });
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
