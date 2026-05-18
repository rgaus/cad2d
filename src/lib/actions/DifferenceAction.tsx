import React from "react";
import { type Geom, difference } from "polyclip-ts";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import { type Id, type PolygonSegment } from "@/lib/geometry/types";
import { SheetPosition } from "@/lib/viewport/types";
import { arcToLineSegments, ellipseToPolygon, rectangleToPolygon } from "@/lib/math";

export class DifferenceAction extends BaseAction {
  type = "difference" as const;
  label = "Difference";
  desc = "Subtracts subsequent selected geometries from the first selected geometry.";
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <rect x="3" y="3" width="14" height="14" strokeLinejoin="round" />
        <line x1="8" y1="8" x2="21" y2="21" strokeLinecap="round" />
      </svg>
    );
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
          const points = this.extractPointsFromSegments(rectangleToPolygon(rect.upperLeft, rect.lowerRight));
          extractedPolygons.push(points);
          if (firstFillColor === null) {
            firstFillColor = rect.fillColor;
          }
        } else {
          const ellipse = geometryStore.getEllipseById(id);
          if (ellipse) {
            const points = this.extractPointsFromSegments(ellipseToPolygon(ellipse.center, ellipse.radiusX, ellipse.radiusY));
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

    const clipPolys = extractedPolygons.map(pts =>
      [pts.map(p => [p.x, p.y] as [number, number])]  // wrap in array for polyclip-ts format
    );

    const result = difference(...clipPolys as [Geom, Geom]);

    if (result.length > 1) {
      console.warn('Difference result contains multiple polygons (holes detected), using first polygon only');
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

    const newPolygonId = await historyManager.recordTransaction('boolean-difference', async () => {
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
          const curve = { start: prevPoint, end: seg.point, controlPointA: seg.controlPointA, controlPointB: seg.controlPointB };
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
