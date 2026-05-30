import { SquaresUnite } from 'lucide-react';
import { type Geom, union } from 'polyclip-ts';
import React from 'react';
import { type PolygonSegment } from '@/lib/geometry';
import { arcToLineSegments, ellipseToPolygon, rectangleToPolygon } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class UnionAction extends BaseAction {
  type = 'union' as const;
  label = 'Union';
  desc =
    'Combines multiple selected geometries into a single polygon by merging their overlapping areas.';
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return <SquaresUnite size={20} />;
  }

  constructor(actionsManager: ActionsManager) {
    super(actionsManager);
    this.updateDisabled = () => {
      this.disabled = this.getSelectionManager().getSelectedIds().length < 2;
    };
    this.getSelectionManager().on('selectionChange', this.updateDisabled);
    this.updateDisabled();
  }

  private updateDisabled: () => void;

  async execute() {
    const geometryStore = this.getGeometryStore();
    const selectionManager = this.getSelectionManager();
    const historyManager = this.getHistoryManager();
    const selectedIds = selectionManager.getSelectedIds();

    if (selectedIds.length < 2) {
      return;
    }

    const extractedPolygons: Array<Array<SheetPosition>> = [];
    let firstFillColor: number | null = null;

    for (const id of selectedIds) {
      const polygon = geometryStore.getPolygonById(id);
      if (polygon) {
        const points = this.extractPointsFromSegments(polygon.points);
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = polygon.fillColor;
        }
      } else {
        const rect = geometryStore.getRectangleById(id);
        if (rect) {
          const points = this.extractPointsFromSegments(
            rectangleToPolygon(rect.upperLeft, rect.lowerRight),
          );
          extractedPolygons.push(points);
          if (firstFillColor === null) {
            firstFillColor = rect.fillColor;
          }
        } else {
          const ellipse = geometryStore.getEllipseById(id);
          if (ellipse) {
            const points = this.extractPointsFromSegments(
              ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY),
            );
            extractedPolygons.push(points);
            if (firstFillColor === null) {
              firstFillColor = ellipse.fillColor;
            }
          }
        }
      }
    }

    if (extractedPolygons.length < 2) {
      return;
    }

    const clipPolys = extractedPolygons.map(
      (pts) => [pts.map((p) => [p.x, p.y] as [number, number])], // wrap in array for polyclip-ts format
    );

    const result = union(...(clipPolys as [Geom, Geom]));

    if (result.length > 1) {
      console.warn(
        'Union result contains multiple polygons (holes detected), using first polygon only',
      );
    }

    const firstResult = result[0];
    if (!firstResult || firstResult.length === 0) {
      return;
    }

    const newPoints: Array<PolygonSegment> = firstResult[0].map(([x, y]) => ({
      type: 'point' as const,
      point: new SheetPosition(x, y),
    }));

    selectionManager.clearSelection();

    const newPolygonId = await historyManager.applyTransaction('boolean-union', () => {
      // 1. Delete old geometries
      for (const id of selectedIds) {
        const polygon = geometryStore.getPolygonById(id);
        if (polygon) {
          geometryStore.deletePolygon(id);
        } else {
          const rect = geometryStore.getRectangleById(id);
          if (rect) {
            geometryStore.deleteRectangle(id);
          } else {
            const ellipse = geometryStore.getEllipseById(id);
            if (ellipse) {
              geometryStore.deleteEllipse(id);
            }
          }
        }
      }

      // 2. Add new boolean operation result
      const newPolygon = geometryStore.addPolygon({
        closed: true,
        points: newPoints,
        fillColor: firstFillColor,
        openAtIndex: 0,
      });
      return newPolygon.id;
    });

    selectionManager.select(newPolygonId);
  }

  private extractPointsFromSegments(segments: Array<PolygonSegment>): Array<SheetPosition> {
    const points: Array<SheetPosition> = [];
    let prevPoint: SheetPosition | null = null;

    for (const seg of segments) {
      if (seg.type === 'point') {
        if (prevPoint === null || !this.positionsEqual(seg.point, prevPoint)) {
          points.push(seg.point);
        }
        prevPoint = seg.point;
      } else if (seg.type === 'arc-quadratic') {
        if (prevPoint !== null) {
          const curve = { start: prevPoint, end: seg.point, controlPoint: seg.controlPoint };
          const sampled = arcToLineSegments(curve);
          for (let i = 1; i < sampled.length; i++) {
            if (!this.positionsEqual(sampled[i], points[points.length - 1])) {
              points.push(sampled[i]);
            }
          }
        }
        prevPoint = seg.point;
      } else if (seg.type === 'arc-cubic') {
        if (prevPoint !== null) {
          const curve = {
            start: prevPoint,
            end: seg.point,
            controlPointA: seg.controlPointA,
            controlPointB: seg.controlPointB,
          };
          const sampled = arcToLineSegments(curve);
          for (let i = 1; i < sampled.length; i++) {
            if (!this.positionsEqual(sampled[i], points[points.length - 1])) {
              points.push(sampled[i]);
            }
          }
        }
        prevPoint = seg.point;
      }
    }

    return points;
  }

  private positionsEqual(a: SheetPosition, b: SheetPosition): boolean {
    return a.x === b.x && a.y === b.y;
  }
}
