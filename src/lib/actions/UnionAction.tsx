import React from "react";
import { BaseAction } from "./BaseAction";
import { ActionsManager } from "./ActionsManager";
import type { Id, PolygonSegment } from "../tools/types";
import { SheetPosition } from "../viewport/types";
import { arcToLineSegments } from "../math";
import polygonClipping from "polygon-clipping";

export class UnionAction extends BaseAction {
  type = "union" as const;
  label = "Union";
  desc = "Combines multiple selected geometries into a single polygon by merging their overlapping areas.";
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
        <path d="M3 12 L12 3 L21 12 L12 21 Z" strokeLinejoin="round" />
        <rect x="8" y="8" width="8" height="8" strokeLinejoin="round" />
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
    const selectedIds = selectionManager.getSelectedIds();

    if (selectedIds.length < 2) {
      return;
    }

    const extractedPolygons: Array<Array<SheetPosition>> = [];
    let firstFillColor: number | null = null;
    const tempPolygonIds: Array<Id> = [];

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
          const converted = geometryStore.convertRectangleToPolygon(id);
          tempPolygonIds.push(converted.id);
          const points = this.extractPointsFromSegments(converted.points);
          extractedPolygons.push(points);
          if (firstFillColor === null) {
            firstFillColor = converted.fillColor;
          }
        } else {
          const ellipse = geometryStore.getEllipseById(id);
          if (ellipse) {
            const converted = geometryStore.convertEllipseToPolygon(id);
            tempPolygonIds.push(converted.id);
            const points = this.extractPointsFromSegments(converted.points);
            extractedPolygons.push(points);
            if (firstFillColor === null) {
              firstFillColor = converted.fillColor;
            }
          }
        }
      }
    }

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

    for (const tempId of tempPolygonIds) {
      geometryStore.deletePolygonDirect(tempId);
    }

    selectionManager.clearSelection();

    if (extractedPolygons.length < 2) {
      return;
    }

    const clipPolys = extractedPolygons.map(pts =>
      pts.map(p => [p.x, p.y] as [number, number])
    );

    const result = polygonClipping.union(clipPolys);

    if (result.length > 1) {
      console.warn('Union result contains multiple polygons (holes detected), using first polygon only');
    }

    const firstResult = result[0];
    if (!firstResult || firstResult.length === 0) {
      return;
    }

    const newPoints: Array<PolygonSegment> = firstResult[0].map(([x, y]) => ({
      type: 'point' as const,
      point: new SheetPosition(x, y),
    }));

    const newPolygon = geometryStore.addPolygon({
      closed: true,
      points: newPoints,
      fillColor: firstFillColor,
      openAtIndex: 0,
    });

    selectionManager.select(newPolygon.id);
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
