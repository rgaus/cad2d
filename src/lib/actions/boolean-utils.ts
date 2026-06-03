import { type PolygonSegment } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { arcToLineSegments, ellipseToPolygon, rectangleToPolygon } from '@/lib/math';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { SheetPosition } from '@/lib/viewport/types';

/** Extracted polygon point data and fill color from selected geometry. */
export type ExtractedGeometry = {
  polygons: Array<Array<[number, number]>>;
  firstFillColor: number | null;
};

/**
 * Extracts polygon contours and fill color from a set of selected geometry IDs.
 * Converts rectangles and ellipses to polygon representations.
 */
export function extractGeometry(
  geometryStore: GeometryStore,
  selectedIds: Array<string>,
): ExtractedGeometry {
  const extractedPolygons: Array<Array<SheetPosition>> = [];
  let firstFillColor: number | null = null;

  for (const id of selectedIds) {
    const polygon = geometryStore.getPolygonById(id);
    if (polygon) {
      const points = extractPointsFromSegments(polygon.points);
      extractedPolygons.push(points);
      if (firstFillColor === null) {
        firstFillColor = polygon.fillColor;
      }
    } else {
      const rect = geometryStore.getRectangleById(id);
      if (rect) {
        const points = extractPointsFromSegments(
          rectangleToPolygon(rect.upperLeft, rect.lowerRight),
        );
        extractedPolygons.push(points);
        if (firstFillColor === null) {
          firstFillColor = rect.fillColor;
        }
      } else {
        const ellipse = geometryStore.getEllipseById(id);
        if (ellipse) {
          const points = extractPointsFromSegments(
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

  const formatted = extractedPolygons.map((pts) => pts.map((p) => [p.x, p.y] as [number, number]));

  return { polygons: formatted, firstFillColor };
}

function extractPointsFromSegments(segments: Array<PolygonSegment>): Array<SheetPosition> {
  const points: Array<SheetPosition> = [];
  let prevPoint: SheetPosition | null = null;

  for (const seg of segments) {
    if (seg.type === 'point') {
      if (prevPoint === null || !positionsEqual(seg.point, prevPoint)) {
        points.push(seg.point);
      }
      prevPoint = seg.point;
    } else if (seg.type === 'arc-quadratic') {
      if (prevPoint !== null) {
        const curve = { start: prevPoint, end: seg.point, controlPoint: seg.controlPoint };
        const sampled = arcToLineSegments(curve);
        for (let i = 1; i < sampled.length; i++) {
          if (!positionsEqual(sampled[i], points[points.length - 1])) {
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
          if (!positionsEqual(sampled[i], points[points.length - 1])) {
            points.push(sampled[i]);
          }
        }
      }
      prevPoint = seg.point;
    }
  }

  return points;
}

function positionsEqual(a: SheetPosition, b: SheetPosition): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Applies the result of a boolean operation to the geometry store:
 * deletes the original selected geometries and adds a new combined polygon.
 */
export function applyBooleanResult(
  geometryStore: GeometryStore,
  historyManager: HistoryManager,
  selectionManager: SelectionManager,
  selectedIds: Array<string>,
  resultPoints: Array<[number, number]>,
  fillColor: number | null,
  label: string,
): void {
  const newPoints: Array<PolygonSegment> = resultPoints.map(([x, y]) => ({
    type: 'point' as const,
    point: new SheetPosition(x, y),
  }));

  selectionManager.clearSelection();

  historyManager.applyTransaction(label, () => {
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

    const newPolygon = geometryStore.addPolygon({
      closed: true,
      points: newPoints,
      fillColor,
      openAtIndex: 0,
    });
    return newPolygon.id;
  });

  selectionManager.select(newPoints[0].point);
}
