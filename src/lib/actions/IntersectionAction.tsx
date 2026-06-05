import { SquaresUnite } from 'lucide-react';
import { type Geom, intersection } from 'polyclip-ts';
import React from 'react';
import {
  FillColorComponent,
  Polygon,
  type PolygonSegment,
  isEllipse,
  isPolygon,
  isRectangle,
} from '@/lib/geometry';
import { arcToLineSegments, ellipseToPolygon, rectangleToPolygon } from '@/lib/math';
import { SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class IntersectionAction extends BaseAction {
  type = 'intersection' as const;
  label = 'Intersection';
  desc = 'Creates a new polygon from the overlapping area common to all selected geometries.';
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
      const geometry = geometryStore.getById(id);
      if (!geometry) continue;
      if (isPolygon(geometry)) {
        const points = this.extractPointsFromSegments(geometry.points);
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.getOptional(geometry) ?? null;
        }
      } else if (isRectangle(geometry)) {
        const points = this.extractPointsFromSegments(
          rectangleToPolygon(geometry.upperLeft, geometry.lowerRight),
        );
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.get(geometry);
        }
      } else if (isEllipse(geometry)) {
        const points = this.extractPointsFromSegments(
          ellipseToPolygon(geometry.center, geometry.radiusX, geometry.radiusY),
        );
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.get(geometry);
        }
      }
    }

    if (extractedPolygons.length < 2) {
      return;
    }

    const clipPolys = extractedPolygons.map(
      (pts) => [pts.map((p) => [p.x, p.y] as [number, number])], // wrap in array for polyclip-ts format
    );

    const result = intersection(...(clipPolys as [Geom, Geom]));

    if (result.length > 1) {
      console.warn(
        'Intersection result contains multiple polygons (holes detected), using first polygon only',
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

    const newPolygonId = historyManager.applyTransaction('boolean-intersection', () => {
      // 1. Delete old geometries
      for (const id of selectedIds) {
        geometryStore.deleteById(id);
      }

      // 2. Add new boolean operation result
      const newPolygon = geometryStore.addPolygon(
        Polygon.create(newPoints, {
          closed: true,
          fillColor: firstFillColor,
          openAtIndex: 0,
        }),
      );
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
