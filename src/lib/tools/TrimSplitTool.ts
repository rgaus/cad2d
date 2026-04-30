import { BaseTool } from './BaseTool';
import { ToolManager } from './ToolManager';
import type { ToolType, Id, SheetPosition } from './types';
import { ScreenPosition, ViewportState, LineSegment, QuadraticCurve, CubicCurve } from '../viewport/types';
import { proximityBoundingBox, CohenSutherland, distance, DeCasteljau } from '../math';
import { Intersection } from '../math/intersection';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';

/** Default pixel threshold for detecting intersection points. */
const DEFAULT_PIXEL_THRESHOLD = 16;

/** Data emitted when an intersection point is found. */
export type SplitIntersectionData = {
  /** The exact sheet position where segments intersect. */
  point: SheetPosition;
  /** List of all shapes and their segments that intersect at this point. */
  targets: Array<{
    /** The id of the shape. */
    id: Id;
    /** The type of the shape. */
    type: 'polygon' | 'rectangle' | 'ellipse';
    /** The index of the segment in the shape's points array. */
    segmentIndex: number;

    segment: CubicCurve<SheetPosition> | LineSegment<SheetPosition> | QuadraticCurve<SheetPosition>;

    /** The split ratio (t parameter) for curve splitting. */
    splitRatio: number;
  }>;
};

/** Events emitted by the TrimSplit tool. */
export type TrimSplitToolEvents = {
  /** Emitted when the mouse moves and finds an intersection point with 2+ segments at exact same position,
   * or null if no valid intersection exists within the threshold. */
  splitIntersectionPoint: (data: SplitIntersectionData | null) => void;
};

/**
 * TrimSplit tool - allows inserting intersection points into two or more segments.
 *
 * Algorithm:
 * 1. On mouse move, build a proximity bounding box around the cursor
 * 2. Filter candidate segments using Cohen-Sutherland (line/quad/cubic vs bounding box)
 * 3. Compute all pairwise intersections between candidate segments
 * 4. Group all intersections by exact coordinate
 * 5. Find closest group to mouse cursor
 * 6. Emit intersection data if group has 2+ segments
 * 7. On click, split all segments at the intersection point
 */
export class TrimSplitTool extends BaseTool<TrimSplitToolEvents> {
  readonly type = 'trim-split' as const;

  /** Current intersection data if found, null otherwise. */
  private currentIntersection: SplitIntersectionData | null = null;

  getCursor(): string {
    return 'default';
  }

  handleMouseDown(): void {
    if (!this.currentIntersection) {
      return;
    }

    const geometryStore = this.getGeometryStore();
    const intersectionPoint = this.currentIntersection.point;
    const targets = this.currentIntersection.targets;

    // Go shape by shape and apply app splits
    const targetsByShapeId = new Map<string, SplitIntersectionData["targets"]>();
    for (const target of targets) {
      const targets = targetsByShapeId.get(target.id) ?? [];
      targetsByShapeId.set(target.id, [...targets, target]);
    }

    for (const [id, targets] of targetsByShapeId.entries()) {
      const targetType = targets[0].type;
      let polygon;
      switch (targetType) {
        case 'polygon':
          polygon = this.getGeometryStore().getPolygonById(id);
          if (!polygon) {
            continue;
          }
          break;
        case 'ellipse':
          polygon = geometryStore.convertEllipseToPolygon(id);
          break;
        case 'rectangle':
          polygon = geometryStore.convertRectangleToPolygon(id);
          break;
      }

      this.getGeometryStore().updatePolygon(polygon.id, (polygon) => {
        let points = polygon.points.slice();

        const sortedTargets = targets.sort((a, b) => a.segmentIndex = b.segmentIndex);
        for (let i = 0; i < sortedTargets.length; i += 1) {
          const target = sortedTargets[i];
          const segment = polygon.points[target.segmentIndex];
          if (!segment) {
            continue;
          }

          // 2. Split the relevant segment and update the polygon
          if ('controlPoint' in target.segment) {
            // Quadratic curve - split at the split ratio, and replace the one curve with the split curve:
            const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(target.segment, target.splitRatio);
            points.splice(
              target.segmentIndex,
              1,
              { type: 'arc-quadratic', point: leftCurve.end, controlPoint: leftCurve.controlPoint },
              { type: 'arc-quadratic', point: rightCurve.end, controlPoint: rightCurve.controlPoint },
            );
            i += 1;

          } else if ('controlPointA' in target.segment && 'controlPointB' in target.segment) {
            // Cubic curve - split at the split ratio, and replace the one curve with the split curve:
            const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(target.segment, target.splitRatio);
            points.splice(
              target.segmentIndex,
              1,
              { type: 'arc-cubic', point: leftCurve.end, controlPointA: leftCurve.controlPointA, controlPointB: leftCurve.controlPointB },
              { type: 'arc-cubic', point: rightCurve.end, controlPointA: rightCurve.controlPointA, controlPointB: rightCurve.controlPointB },
            );
            i += 1;

          } else {
            // Linearly connect to the new midpoint by inserting a point in the points array.
            points.splice(target.segmentIndex, 0, { type: 'point', point: intersectionPoint });
            i += 1;
          }
        }

        return { ...polygon, points };
      });
    }

    this.currentIntersection = null;
    this.emit('splitIntersectionPoint', null);
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const sheetPos = screenPos.toWorld(viewport).toSheet();
    const sheetThreshold = DEFAULT_PIXEL_THRESHOLD / SHEET_UNITS_TO_PIXELS / viewport.scale;

    const intersection = this.computeIntersectionAtPoint(sheetPos, sheetThreshold);

    this.currentIntersection = intersection;
    this.emit('splitIntersectionPoint', intersection);
  }

  /** Computes intersection data for a given point using the new algorithm.
   *
   * @param point - The sheet position of the mouse cursor.
   * @param threshold - The threshold in sheet units for including segments.
   * @returns SplitIntersectionData if 2+ segments intersect at exact same position, null otherwise.
   */
  private computeIntersectionAtPoint(
    mousePos: SheetPosition,
    threshold: number,
  ): SplitIntersectionData | null {
    const geometryStore = this.getGeometryStore();
    const allGeometry = geometryStore.getAllGeometryAsSegments();

    const searchBox = proximityBoundingBox(mousePos, threshold);
    console.log('SEARCH threshold:', threshold, 'box:', searchBox.position.x, searchBox.position.y, searchBox.width, searchBox.height);
    console.log('Mouse pos:', mousePos.x, mousePos.y);

    // Step 1: Filter candidate segments using Cohen-Sutherland
    const candidates: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if ('controlPointA' in segment && 'controlPointB' in segment) {
          mightIntersect = true;//CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
        } else if ('controlPoint' in segment) {
          mightIntersect = true;//CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, searchBox);
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, searchBox);
        }

        // console.log('FOO', shape.id, index, segment, '=>', mightIntersect);
        console.log('Candidate:', shape.id, shape.type, index, 'segment:', JSON.stringify({s: segment.start ? {x: segment.start.x, y: segment.start.y} : null, e: segment.end ? {x: segment.end.x, y: segment.end.y} : null}), 'mightIntersect:', mightIntersect);
        if (mightIntersect) {
          candidates.push({
            shapeId: shape.id,
            shapeType: shape.type,
            segmentIndex: index,
            segment,
          });
        }
      }
    }

    if (candidates.length < 2) {
      return null;
    }

    // Step 2: Compute all pairwise intersections
    const intersections: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
      point: SheetPosition;
      t1: number;
      t2?: number;
    }> = [];

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const segA = candidates[i];
        const segB = candidates[j];

        const segAIntersections = Intersection.computeSegmentPairIntersections(
          segA.segment,
          segB.segment,
        );
        if (segAIntersections.length > 0) {
          console.log('BAR', segA.shapeId, segA.segmentIndex, segB.shapeId, segB.segmentIndex, '=>', segAIntersections);
        }

        for (const [point, tA, tB] of segAIntersections) {
          // Don't log intersection if it's at the end of a segment, as there already is a point
          // there.
          if (tA === 0 || tA === 1 || tB === 0 || tB === 1)  {
            continue;
          }

          intersections.push({
            shapeId: segA.shapeId,
            shapeType: segA.shapeType,
            segmentIndex: segA.segmentIndex,
            segment: segA.segment,
            point,
            t1: tA,
            t2: tB,
          });
          intersections.push({
            shapeId: segB.shapeId,
            shapeType: segB.shapeType,
            segmentIndex: segB.segmentIndex,
            segment: segB.segment,
            point,
            t1: tB,
            t2: tA,
          });
        }
      }
    }
    console.log('INTERSECTIONS:', intersections);

    if (intersections.length === 0) {
      return null;
    }

    // Step 3: Group intersections by exact coordinate
    const pointGroups = new Map<string, Array<typeof intersections[0]>>();

    for (const inters of intersections) {
      const key = `${inters.point.x.toFixed(10)},${inters.point.y.toFixed(10)}`;
      console.log('Adding intersection:', key, 'from shape:', inters.shapeId, 'segment:', inters.segmentIndex, 'point:', inters.point.x, inters.point.y);
      let group = pointGroups.get(key);
      if (!group) {
        group = [];
        pointGroups.set(key, group);
      }
      group.push(inters);
    }

    // Step 4: Find closest group to mouse cursor
    let closestGroup: Array<typeof intersections[0]> | null = null;
    let closestGroupDist = Infinity;

    console.log('Point groups:');
    for (const [key, group] of pointGroups.entries()) {
      console.log('  Group:', key, 'length:', group.length);
      for (const c of group) {
        const d = distance(c.point, mousePos);
        console.log('    shape:', c.shapeId, 'segment:', c.segmentIndex, 'point:', c.point.x, c.point.y, 'dist:', d);
      }
    }

    for (const group of pointGroups.values()) {
      if (group.length < 2) {
        console.log('Skipping group length < 2:', group.length);
        continue;
      }

      const dist = distance(group[0].point, mousePos);
      console.log('Group dist:', dist, 'threshold:', threshold, 'mouse:', mousePos.x, mousePos.y);
      if (dist < closestGroupDist) {
        closestGroupDist = dist;
        closestGroup = group;
      }
    }

    console.log('Closest group:', closestGroup ? closestGroup.length : 'null', 'dist:', closestGroupDist);
    if (!closestGroup || closestGroup.length < 2) {
      return null;
    }

    if (closestGroupDist > threshold) {
      return null;
    }

    // Step 5: Build targets from the closest group
    const targets = closestGroup.map((c) => ({
      id: c.shapeId,
      type: c.shapeType,
      segment: c.segment,
      segmentIndex: c.segmentIndex,
      splitRatio: c.t1,
    }));

    return {
      point: closestGroup[0].point,
      targets,
    };
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentIntersection = null;
  }
}
