import { SquaresUnite } from 'lucide-react';
import { type Geom, union } from 'polyclip-ts';
import React from 'react';
import {
  EllipseComponent,
  FillColorComponent,
  Geometry,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  RectangleComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
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
      const geometry = geometryStore.getById(id);
      if (!geometry) continue;
      if (Geometry.hasComponent(geometry, PolygonComponent)) {
        const points = this.extractPointsFromSegments(PolygonComponent.get(geometry).points);
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.getOptional(geometry) ?? null;
        }
      } else if (Geometry.hasComponent(geometry, RectangleComponent)) {
        const rectangle = RectangleComponent.get(geometry);
        const points = this.extractPointsFromSegments(
          rectangleToPolygon(rectangle.upperLeft, rectangle.lowerRight),
        );
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.getOptional(geometry) ?? null;
        }
      } else if (Geometry.hasComponent(geometry, EllipseComponent)) {
        const ellipseData = EllipseComponent.get(geometry);
        const points = this.extractPointsFromSegments(
          ellipseToPolygon(ellipseData.center, ellipseData.radiusX, ellipseData.radiusY),
        );
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = FillColorComponent.getOptional(geometry) ?? null;
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

    if (result.length === 0 || result[0].length === 0) {
      return;
    }

    selectionManager.clearSelection();

    const newPolygonIds: Array<string> = await historyManager.applyTransaction(
      'boolean-union',
      () => {
        // 1. Delete old geometries
        for (const id of selectedIds) {
          geometryStore.deleteById(id);
        }

        // 2. Add new boolean operation results
        const ids: Array<string> = [];
        for (const polygon of result) {
          const newPoints: Array<PolygonSegment> = polygon[0].map(([x, y]) => ({
            type: 'point' as const,
            point: new SheetPosition(x, y),
          }));
          const newPolygon = geometryStore.addOrdered(
            ID_PREFIXES.polygon,
            Polygon.create(newPoints, {
              closed: true,
              fillColor: firstFillColor,
              openAtIndex: 0,
            }),
          );
          ids.push(newPolygon.id);
        }
        return ids;
      },
    );

    selectionManager.selectAll(new Set(newPolygonIds));

    selectionManager.selectAll(new Set(newPolygonIds));
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
