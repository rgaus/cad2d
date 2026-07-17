import { FlipHorizontal } from 'lucide-react';
import React from 'react';
import {
  EllipseComponent,
  Entity,
  PolygonComponent,
  type PolygonSegment,
  RectangleComponent,
} from '@/lib/geometry';
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
        const polygonGeom = geometryStore.getByIdWithComponent(id, PolygonComponent);
        if (polygonGeom) {
          geometryStore.updateById(id, () => ({
            ...polygonGeom,
            components: {
              ...polygonGeom.components,
              polygon: {
                ...polygonGeom.components.polygon,
                points: flipPolygonPoints(PolygonComponent.get(polygonGeom).points, centerX),
              },
            },
          }));
          continue;
        }

        const rectGeom = geometryStore.getByIdWithComponent(id, RectangleComponent);
        if (rectGeom) {
          const rect = RectangleComponent.get(rectGeom);
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
          const newCenter = Flip.horizontal(ellipse.center, centerX);

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
