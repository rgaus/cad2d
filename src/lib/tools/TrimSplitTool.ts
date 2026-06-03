import {
  type CubicBezierSegment,
  type Id,
  type PointSegment,
  type QuadraticBezierSegment,
} from '@/lib/geometry';
import { UndoEntry } from '@/lib/history/types';
import {
  CohenSutherland,
  DeCasteljau,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
  distVec2,
  distance,
  lineSegmentBoundingBox,
  proximityBoundingBox,
} from '@/lib/math';
import { Intersection } from '../math/intersection';
import {
  CubicCurve,
  LineSegment,
  QuadraticCurve,
  ScreenPosition,
  SheetPosition,
  ViewportState,
  isCubicCurve,
  isQuadraticCurve,
} from '../viewport/types';
import { BaseTool } from './BaseTool';

/** Default pixel threshold for detecting intersection points. */
const DEFAULT_PIXEL_BOUNDING_BOX_THRESHOLD_PX = 16;

const DEFAULT_PIXEL_INTERSECTION_MAX_THRESHOLD_PX = 2;

/** Data emitted when an intersection point is found. */
export type SplitPoint = {
  type: 'split-point';
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

export type TrimSegment = {
  type: 'trim-segment';
  trimmedSegment:
    | CubicCurve<SheetPosition>
    | LineSegment<SheetPosition>
    | QuadraticCurve<SheetPosition>;
  nearestCursorPoint: SheetPosition;
  shapeId: Id;
  shapeType: 'polygon' | 'rectangle' | 'ellipse';
  shapeSegment:
    | CubicCurve<SheetPosition>
    | LineSegment<SheetPosition>
    | QuadraticCurve<SheetPosition>;
  shapeSegmentIndex: number;
  /** t parameter on shapeSegment where trimmed segment starts. */
  tStart: number;
  /** t parameter on shapeSegment where trimmed segment ends. */
  tEnd: number;
};

/** Events emitted by the TrimSplit tool. */
export type TrimSplitToolEvents = {
  /** Emitted when the mouse moves and finds an intersection point with 2+ segments at exact same position,
   * or null if no valid intersection exists within the threshold. */
  splitPointOrTrimSegmentChange: (data: SplitPoint | TrimSegment | null) => void;
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
  focusKeyCombo = 't' as const;

  /** Current intersection data if found, null otherwise. */
  private currentTrimSpit: SplitPoint | TrimSegment | null = null;

  handlePointerDown(): boolean {
    switch (this.currentTrimSpit?.type) {
      case 'split-point':
        this.processCurrentIntersection();
        return true;
      case 'trim-segment':
        this.processCurrentTrim();
        return true;
    }
    return false;
  }

  processCurrentIntersection() {
    if (this.currentTrimSpit?.type !== 'split-point') {
      return;
    }

    const geometryStore = this.getGeometryStore();
    const intersectionPoint = this.currentTrimSpit.point;
    const targets = this.currentTrimSpit.targets;

    // Go shape by shape and apply app splits
    const targetsByShapeId = new Map<string, SplitPoint['targets']>();
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

        const sortedTargets = targets.sort((a, b) => a.segmentIndex - b.segmentIndex);
        for (let i = 0; i < sortedTargets.length; i += 1) {
          const target = sortedTargets[i];
          const segment = polygon.points[target.segmentIndex];
          if (!segment) {
            continue;
          }

          // 2. Split the relevant segment and update the polygon
          if (isQuadraticCurve(target.segment)) {
            // Quadratic curve - split at the split ratio, and replace the one curve with the split curve:
            const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(
              target.segment,
              target.splitRatio,
            );
            points.splice(
              target.segmentIndex,
              1,
              { type: 'arc-quadratic', point: leftCurve.end, controlPoint: leftCurve.controlPoint },
              {
                type: 'arc-quadratic',
                point: rightCurve.end,
                controlPoint: rightCurve.controlPoint,
              },
            );
            i += 1;
          } else if (isCubicCurve(target.segment)) {
            // Cubic curve - split at the split ratio, and replace the one curve with the split curve:
            const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(
              target.segment,
              target.splitRatio,
            );
            points.splice(
              target.segmentIndex,
              1,
              {
                type: 'arc-cubic',
                point: leftCurve.end,
                controlPointA: leftCurve.controlPointA,
                controlPointB: leftCurve.controlPointB,
              },
              {
                type: 'arc-cubic',
                point: rightCurve.end,
                controlPointA: rightCurve.controlPointA,
                controlPointB: rightCurve.controlPointB,
              },
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

    this.currentTrimSpit = null;
    this.emit('splitPointOrTrimSegmentChange', null);
    return false;
  }

  processCurrentTrim() {
    if (this.currentTrimSpit?.type !== 'trim-segment') {
      return;
    }

    const geometryStore = this.getGeometryStore();
    const { trimmedSegment, shapeId, shapeType, shapeSegment, shapeSegmentIndex, tStart, tEnd } =
      this.currentTrimSpit;

    // Guard against zero-length trimmed segment
    if (distVec2(trimmedSegment.start, trimmedSegment.end) < 0.0001) {
      return;
    }

    // Convert shape to polygon if needed
    let polygon;
    switch (shapeType) {
      case 'polygon':
        polygon = geometryStore.getPolygonById(shapeId);
        if (!polygon) {
          return;
        }
        break;
      case 'ellipse':
        polygon = geometryStore.convertEllipseToPolygon(shapeId);
        break;
      case 'rectangle':
        polygon = geometryStore.convertRectangleToPolygon(shapeId);
        break;
    }

    // Step 1: Collect all insertions from other polygons first (skip source polygon)
    // We collect all insertions and sort by segmentIndex descending to avoid index shifting issues
    const pendingInsertions: Array<{
      polygonId: Id;
      segmentIndex: number;
      t: number;
      point: SheetPosition;
    }> = [];

    for (const endpoint of [trimmedSegment.start, trimmedSegment.end] as const) {
      const polygonsToUpdate = this.findPolygonsWithSegmentThroughPoint(endpoint, polygon.id);
      for (const { polygonId, segmentIndex, t } of polygonsToUpdate) {
        if (polygonId === polygon.id) {
          continue; // Skip source polygon - handled in Step 2
        }
        if (t === 0 || t === 1) {
          continue; // Endpoint already exists at vertex
        }
        pendingInsertions.push({ polygonId, segmentIndex, t, point: endpoint });
      }
    }

    // Sort by segmentIndex descending so we insert from high to low indices
    // This prevents index shifting from affecting subsequent insertions
    pendingInsertions.sort((a, b) => b.segmentIndex - a.segmentIndex);

    // Apply all insertions to other polygons
    for (const insertion of pendingInsertions) {
      this.insertPointIntoSegment(
        insertion.polygonId,
        insertion.segmentIndex,
        insertion.t,
        insertion.point,
      );
    }

    // Step 2: Update source polygon with trimmed segment
    // Replace the original segment with [shortenedStart?, trimmedSegment, shortenedEnd?]
    // Only include shortened portions if they actually trim something (t > 0 for start, t < 1 for end)
    geometryStore.updatePolygon(polygon.id, (old) => {
      const replacementSegments: Array<PointSegment | QuadraticBezierSegment | CubicBezierSegment> =
        [];

      if (tStart > 0.001) {
        const shortenedStart = this.curveToPolygonSegment(
          this.buildShortenedCurve(shapeSegment, 0, tStart),
        );
        replacementSegments.push(shortenedStart);
      }

      const trimmedPoint = this.curveToPolygonSegment(trimmedSegment);
      replacementSegments.push(trimmedPoint);

      if (tEnd < 0.999) {
        const shortenedEnd = this.curveToPolygonSegment(
          this.buildShortenedCurve(shapeSegment, tEnd, 1),
        );
        replacementSegments.push(shortenedEnd);
      }

      const points = [...old.points];
      points.splice(shapeSegmentIndex, 1, ...replacementSegments);

      return { ...old, points };
    });

    // Step 3: "Open" the polygon by removing the trimmed segment
    // Reorder points so first = shortenedStart.point, last = trimmedPoint.point, and set closed: false
    const wasClosedBeforeOpen = polygon.closed;
    geometryStore.updatePolygon(polygon.id, (old) => {
      // Find indices of start and end points
      let startIdx = -1;
      let endIdx = -1;
      for (let i = 0; i < old.points.length; i++) {
        const p = old.points[i].point;
        if (
          Math.abs(p.x - trimmedSegment.start.x) < 0.0001 &&
          Math.abs(p.y - trimmedSegment.start.y) < 0.0001
        ) {
          startIdx = i;
        }
        if (
          Math.abs(p.x - trimmedSegment.end.x) < 0.0001 &&
          Math.abs(p.y - trimmedSegment.end.y) < 0.0001
        ) {
          endIdx = i;
        }
      }

      if (startIdx === -1 || endIdx === -1) {
        // Couldn't find the points - shouldn't happen, but just return unchanged
        return old;
      }

      // Rotate points array so startIdx becomes index 0
      // And also cut out the trimmed point segment from the list
      const truncatedPoints = [
        ...old.points.slice(startIdx + 1),
        ...old.points.slice(1, startIdx + 1),
      ];

      return { ...old, points: truncatedPoints, closed: false };
    });
    if (wasClosedBeforeOpen) {
      this.getHistoryManager().push(UndoEntry.polygonClose(polygon.id, true, false));
    }
  }

  handlePointerMove(screenPos: ScreenPosition, viewport: ViewportState): boolean {
    const sheetPos = screenPos.toWorld(viewport).toSheet();
    const sheetThreshold = DEFAULT_PIXEL_BOUNDING_BOX_THRESHOLD_PX / viewport.scale;
    // console.log('FOO', DEFAULT_PIXEL_BOUNDING_BOX_THRESHOLD_PX / SHEET_UNITS_TO_PIXELS / viewport.scale, sheetThreshold);

    const intersection = this.computeIntersectionAtPoint(sheetPos, sheetThreshold, viewport);
    // console.log('A INTERS', intersection);
    if (intersection) {
      this.currentTrimSpit = intersection;
      this.emit('splitPointOrTrimSegmentChange', intersection);
      return;
    }
    this.currentTrimSpit = null;

    const trimSegment = this.computeTrimSegment(sheetPos, sheetThreshold);
    // console.log('B TRIM', trimSegment);
    if (trimSegment) {
      this.currentTrimSpit = trimSegment;
      this.emit('splitPointOrTrimSegmentChange', trimSegment);
      return;
    }

    this.currentTrimSpit = null;
    this.emit('splitPointOrTrimSegmentChange', null);
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
    viewport: ViewportState,
  ): SplitPoint | null {
    const geometryStore = this.getGeometryStore();
    const allGeometry = geometryStore.getAllGeometryAsSegments();

    const searchBox = proximityBoundingBox(mousePos, threshold);
    // console.log('SEARCH threshold:', threshold, 'box:', searchBox.position.x, searchBox.position.y, searchBox.width, searchBox.height);
    // console.log('Mouse pos:', mousePos.x, mousePos.y);

    // Step 1: Filter candidate segments using Cohen-Sutherland
    const candidates: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if (isCubicCurve(segment)) {
          mightIntersect = true; //CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
        } else if (isQuadraticCurve(segment)) {
          mightIntersect = true; //CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, searchBox);
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, searchBox);
        }

        // console.log('Candidate:', shape.id, shape.type, index, 'segment:', JSON.stringify({s: segment.start ? {x: segment.start.x, y: segment.start.y} : null, e: segment.end ? {x: segment.end.x, y: segment.end.y} : null}), 'mightIntersect:', mightIntersect);
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
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
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
        // if (segAIntersections.length > 0) {
        //   console.log('BAR', segA.shapeId, segA.segmentIndex, segB.shapeId, segB.segmentIndex, '=>', segAIntersections);
        // }

        for (const [point, tA, tB] of segAIntersections) {
          // Don't log intersection if it's at the end of a segment, as there already is a point
          // there.
          if (tA === 0 || tA === 1 || tB === 0 || tB === 1) {
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
    // console.log('INTERSECTIONS:', intersections);

    if (intersections.length === 0) {
      return null;
    }

    // Step 3: Group intersections by exact coordinate
    const pointGroups = new Map<string, Array<(typeof intersections)[0]>>();

    for (const inters of intersections) {
      const key = `${inters.point.x.toFixed(10)},${inters.point.y.toFixed(10)}`;
      // console.log('Adding intersection:', key, 'from shape:', inters.shapeId, 'segment:', inters.segmentIndex, 'point:', inters.point.x, inters.point.y);
      let group = pointGroups.get(key);
      if (!group) {
        group = [];
        pointGroups.set(key, group);
      }
      group.push(inters);
    }

    // Step 4: Find closest group to mouse cursor
    let closestGroup: Array<(typeof intersections)[0]> | null = null;
    let closestGroupDist = Infinity;

    // console.log('Point groups:');
    // for (const [key, group] of pointGroups.entries()) {
    //   console.log('  Group:', key, 'length:', group.length);
    //   for (const c of group) {
    //     const d = distance(c.point, mousePos);
    //     console.log('    shape:', c.shapeId, 'segment:', c.segmentIndex, 'point:', c.point.x, c.point.y, 'dist:', d);
    //   }
    // }

    for (const group of pointGroups.values()) {
      if (group.length < 2) {
        // console.log('Skipping group length < 2:', group.length);
        continue;
      }

      const dist = distance(group[0].point, mousePos);
      // console.log('Group dist:', dist, 'threshold:', threshold, 'mouse:', mousePos.x, mousePos.y);
      if (dist < closestGroupDist) {
        closestGroupDist = dist;
        closestGroup = group;
      }
    }

    // console.log('Closest group:', closestGroup ? closestGroup.length : 'null', 'dist:', closestGroupDist);
    if (!closestGroup || closestGroup.length < 2) {
      return null;
    }

    if (closestGroupDist > DEFAULT_PIXEL_INTERSECTION_MAX_THRESHOLD_PX * viewport.scale) {
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
      type: 'split-point',
      point: closestGroup[0].point,
      targets,
    };
  }

  private computeTrimSegment(mousePos: SheetPosition, threshold: number): TrimSegment | null {
    const geometryStore = this.getGeometryStore();
    const allGeometry = geometryStore.getAllGeometryAsSegments();

    const searchBox = proximityBoundingBox(mousePos, threshold);
    // console.log('SEARCH threshold:', threshold, 'box:', searchBox.position.x, searchBox.position.y, searchBox.width, searchBox.height);
    // console.log('Mouse pos:', mousePos.x, mousePos.y);

    // Step 1: Filter candidate segments using Cohen-Sutherland
    const candidates: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if (isCubicCurve(segment)) {
          mightIntersect = true; //CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
        } else if (isQuadraticCurve(segment)) {
          mightIntersect = true; //CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, searchBox);
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, searchBox);
        }

        // console.log('Candidate:', shape.id, shape.type, index, 'segment:', JSON.stringify({s: segment.start ? {x: segment.start.x, y: segment.start.y} : null, e: segment.end ? {x: segment.end.x, y: segment.end.y} : null}), 'mightIntersect:', mightIntersect);
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

    // Step 2: Get closest candidate geometry to cursor
    let closestSegmentDistance = Infinity;
    let closestSegment: {
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;

      segment:
        | CubicCurve<SheetPosition>
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>;
      tOfNearestCursorPoint: number;
      nearestCursorPoint: SheetPosition;
    } | null = null;
    for (const candidate of candidates) {
      if (isCubicCurve(candidate.segment)) {
        const result = closestPointOnCubicCurve(candidate.segment, mousePos);
        if (result.distance < closestSegmentDistance) {
          closestSegmentDistance = result.distance;
          closestSegment = {
            shapeId: candidate.shapeId,
            shapeType: candidate.shapeType,
            segmentIndex: candidate.segmentIndex,

            segment: candidate.segment,
            tOfNearestCursorPoint: result.t,
            nearestCursorPoint: result.point,
          };
        }
      } else if (isQuadraticCurve(candidate.segment)) {
        const result = closestPointOnQuadraticCurve(candidate.segment, mousePos);
        if (result.distance < closestSegmentDistance) {
          closestSegmentDistance = result.distance;
          closestSegment = {
            shapeId: candidate.shapeId,
            shapeType: candidate.shapeType,
            segmentIndex: candidate.segmentIndex,

            segment: candidate.segment,
            tOfNearestCursorPoint: result.t,
            nearestCursorPoint: result.point,
          };
        }
      } else {
        const result = closestPointOnSegment(
          candidate.segment.start,
          candidate.segment.end,
          mousePos,
        );
        if (result.distance < closestSegmentDistance) {
          closestSegmentDistance = result.distance;
          closestSegment = {
            shapeId: candidate.shapeId,
            shapeType: candidate.shapeType,
            segmentIndex: candidate.segmentIndex,

            segment: candidate.segment,
            tOfNearestCursorPoint: result.t,
            nearestCursorPoint: result.point,
          };
        }
      }
    }

    if (!closestSegment) {
      // No segment found close to the mouse cursor
      return null;
    }

    // console.log('>>>', closestSegment);

    // Step 3: Get all geometries that intersect `closestSegment`, and get the intersection points
    // of these geometries

    const closestSegmentBoundingBox = lineSegmentBoundingBox(closestSegment.segment);

    const intersectionCandidates: Array<{
      shapeId: Id;
      shapeType: 'polygon' | 'rectangle' | 'ellipse';
      segmentIndex: number;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
      intersectionPoint: SheetPosition;
      t: number;
    }> = [];

    for (const shape of allGeometry) {
      if (shape.id === closestSegment.shapeId) {
        // This is the same polygon as "closestSegment", so skip
        continue;
      }
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if (isCubicCurve(segment)) {
          mightIntersect = true; //CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, closestSegmentBoundingBox);
        } else if (isQuadraticCurve(segment)) {
          mightIntersect = true; //CohenSutherland.quadraticCurveMightIntersectBoundingBox(segment, closestSegmentBoundingBox);
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(
            segment,
            closestSegmentBoundingBox,
          );
        }

        if (!mightIntersect) {
          continue;
        }

        const intersections = Intersection.computeSegmentPairIntersections(
          closestSegment.segment,
          segment,
        );
        for (const [point, t] of intersections) {
          intersectionCandidates.push({
            shapeId: shape.id,
            shapeType: shape.type,
            segmentIndex: index,
            segment,
            intersectionPoint: point,
            t,
          });
        }
      }
    }

    // Step 4: Pick a geometry on either side of the `closestSegmentT` value in the positive and
    // negative direction, and that is our "trimmed segment".

    // const nearestOnPositiveSide = intersectionCandidates
    //   .filter((inters) => inters.t > closestSegment.tOfNearestCursorPoint)
    //   .sort((a, b) => a.t - b.t)
    //   .at(0) ?? { t: 1, intersectionPoint: closestSegment.segment.end };
    // const nearestOnNegativeSide = intersectionCandidates
    //   .filter((inters) => inters.t < closestSegment.tOfNearestCursorPoint)
    //   .sort((a, b) => b.t - a.t)
    //   .at(0) ?? { t: 0, intersectionPoint: closestSegment.segment.end };

    const nearestOnPositiveSide = intersectionCandidates
      .filter((inters) => inters.t > closestSegment.tOfNearestCursorPoint)
      .sort((a, b) => a.t - b.t)
      .at(0) ?? { t: 1, intersectionPoint: closestSegment.segment.end };
    const nearestOnNegativeSide = intersectionCandidates
      .filter((inters) => inters.t < closestSegment.tOfNearestCursorPoint)
      .sort((a, b) => b.t - a.t)
      .at(0) ?? { t: 0, intersectionPoint: closestSegment.segment.start };

    // console.log('>>>', closestSegment.segment, 'BOUNDED BY', nearestOnPositiveSide, nearestOnNegativeSide);

    let trimmedSegment;
    if (isCubicCurve(closestSegment.segment)) {
      const [_leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(
        closestSegment.segment,
        nearestOnPositiveSide.t,
      );
      const [leftCurve, _rightCurve] = DeCasteljau.splitCubicBezier(
        rightCurve,
        nearestOnNegativeSide.t,
      );
      trimmedSegment = leftCurve;
    } else if (isQuadraticCurve(closestSegment.segment)) {
      const [_leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(
        closestSegment.segment,
        nearestOnNegativeSide.t,
      );
      const [leftCurve, _rightCurve] = DeCasteljau.splitQuadraticBezier(
        rightCurve,
        nearestOnPositiveSide.t,
      );
      trimmedSegment = leftCurve;
    } else {
      trimmedSegment = {
        start: nearestOnNegativeSide.intersectionPoint,
        end: nearestOnPositiveSide.intersectionPoint,
      };
    }

    return {
      type: 'trim-segment',
      nearestCursorPoint: closestSegment.nearestCursorPoint,
      trimmedSegment,
      shapeId: closestSegment.shapeId,
      shapeType: closestSegment.shapeType,
      shapeSegment: closestSegment.segment,
      shapeSegmentIndex: closestSegment.segmentIndex,
      tStart: nearestOnNegativeSide.t,
      tEnd: nearestOnPositiveSide.t,
    };
  }

  /**
   * Builds a shortened version of a curve representing the portion from tStart to tEnd.
   * Preserves the curve type (line, quadratic, or cubic).
   */
  private buildShortenedCurve(
    curve: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
    tStart: number,
    tEnd: number,
  ): LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition> {
    if (isCubicCurve(curve)) {
      const [leftFull, _rightFull] = DeCasteljau.splitCubicBezier(curve, tEnd);
      const ratio = tStart / tEnd;
      const [result, _] = DeCasteljau.splitCubicBezier(leftFull, ratio);
      return result;
    } else if (isQuadraticCurve(curve)) {
      const [leftFull, _rightFull] = DeCasteljau.splitQuadraticBezier(curve, tEnd);
      const ratio = tStart / tEnd;
      const [result, _] = DeCasteljau.splitQuadraticBezier(leftFull, ratio);
      return result;
    } else {
      return {
        start: new SheetPosition(
          curve.start.x + (curve.end.x - curve.start.x) * tStart,
          curve.start.y + (curve.end.y - curve.start.y) * tStart,
        ),
        end: new SheetPosition(
          curve.start.x + (curve.end.x - curve.start.x) * tEnd,
          curve.start.y + (curve.end.y - curve.start.y) * tEnd,
        ),
      };
    }
  }

  /**
   * Converts a curve to a polygon point segment format.
   * The curve's end point becomes the segment's point.
   */
  private curveToPolygonSegment(
    curve: CubicCurve<SheetPosition> | QuadraticCurve<SheetPosition> | LineSegment<SheetPosition>,
  ):
    | { type: 'point'; point: SheetPosition }
    | { type: 'arc-quadratic'; point: SheetPosition; controlPoint: SheetPosition }
    | {
        type: 'arc-cubic';
        point: SheetPosition;
        controlPointA: SheetPosition;
        controlPointB: SheetPosition;
      } {
    if (isCubicCurve(curve)) {
      return {
        type: 'arc-cubic',
        point: curve.end,
        controlPointA: curve.controlPointA,
        controlPointB: curve.controlPointB,
      };
    } else if (isQuadraticCurve(curve)) {
      return {
        type: 'arc-quadratic',
        point: curve.end,
        controlPoint: curve.controlPoint,
      };
    } else {
      return {
        type: 'point',
        point: curve.end,
      };
    }
  }

  /**
   * Converts a trimmed segment curve to a polygon point segment format.
   */
  private buildTrimmedSegmentPoint(
    trimmedSegment:
      | CubicCurve<SheetPosition>
      | LineSegment<SheetPosition>
      | QuadraticCurve<SheetPosition>,
  ):
    | { type: 'point'; point: SheetPosition }
    | { type: 'arc-quadratic'; point: SheetPosition; controlPoint: SheetPosition }
    | {
        type: 'arc-cubic';
        point: SheetPosition;
        controlPointA: SheetPosition;
        controlPointB: SheetPosition;
      } {
    if (isCubicCurve(trimmedSegment)) {
      return {
        type: 'arc-cubic',
        point: trimmedSegment.end,
        controlPointA: trimmedSegment.controlPointA,
        controlPointB: trimmedSegment.controlPointB,
      };
    } else if (isQuadraticCurve(trimmedSegment)) {
      return {
        type: 'arc-quadratic',
        point: trimmedSegment.end,
        controlPoint: trimmedSegment.controlPoint,
      };
    } else {
      return {
        type: 'point',
        point: trimmedSegment.end,
      };
    }
  }

  /**
   * Finds all polygons (excluding excludeShapeId) that have a segment passing through the given point.
   * Returns an array of [polygonId, segmentIndex, t] where 0 < t < 1.
   * Each physical segment is only returned once (not twice for each direction).
   * Only includes segments where the closest point is within threshold distance of the query point.
   */
  private findPolygonsWithSegmentThroughPoint(
    point: SheetPosition,
    excludeShapeId: Id,
  ): Array<{ polygonId: Id; segmentIndex: number; t: number }> {
    const geometryStore = this.getGeometryStore();
    const results: Array<{ polygonId: Id; segmentIndex: number; t: number }> = [];
    const seenSegments = new Set<string>();

    // Maximum distance threshold in sheet units - only include points that are actually close
    const DISTANCE_THRESHOLD = 0.01;

    for (const polygon of geometryStore.polygons) {
      if (polygon.id === excludeShapeId) {
        continue;
      }

      for (let i = 0; i < polygon.points.length; i++) {
        const segment = polygon.points[i];
        const prevIndex = i === 0 ? polygon.points.length - 1 : i - 1;
        const prevSegment = polygon.points[prevIndex];

        // Skip segments where the start comes after the end (backwards direction)
        // This handles the wraparound case for non-closed polygons
        if (prevIndex > i) {
          continue;
        }

        // Use canonical key to avoid returning the same segment twice
        const segmentKey = `${polygon.id}-${prevIndex}-${i}`;
        if (seenSegments.has(segmentKey)) {
          continue;
        }
        seenSegments.add(segmentKey);

        let intersection;
        if (segment.type === 'arc-cubic') {
          intersection = closestPointOnCubicCurve(
            {
              start: prevSegment.point,
              controlPointA: segment.controlPointA,
              controlPointB: segment.controlPointB,
              end: segment.point,
            },
            point,
          );
        } else if (segment.type === 'arc-quadratic') {
          intersection = closestPointOnQuadraticCurve(
            {
              start: prevSegment.point,
              controlPoint: segment.controlPoint,
              end: segment.point,
            },
            point,
          );
        } else {
          intersection = closestPointOnSegment(prevSegment.point, segment.point, point);
        }

        // Only include if t is in (0, 1) AND the closest point is actually close to the query point
        if (
          intersection.t > 0 &&
          intersection.t < 1 &&
          intersection.distance < DISTANCE_THRESHOLD
        ) {
          results.push({ polygonId: polygon.id, segmentIndex: i, t: intersection.t });
        }
      }
    }

    return results;
  }

  /**
   * Inserts a point segment at the intersection of a curve at parameter t,
   * splitting the curve into [curve_0_to_t, point, curve_t_to_1].
   */
  private insertPointIntoSegment(
    polygonId: Id,
    segmentIndex: number,
    t: number,
    intersectionPoint: SheetPosition,
  ): void {
    const geometryStore = this.getGeometryStore();
    const polygon = geometryStore.getPolygonById(polygonId);
    if (!polygon) {
      return;
    }

    const segment = polygon.points[segmentIndex];
    const prevIndex = segmentIndex === 0 ? polygon.points.length - 1 : segmentIndex - 1;
    const prevSegment = polygon.points[prevIndex];

    let curveBefore:
      | LineSegment<SheetPosition>
      | QuadraticCurve<SheetPosition>
      | CubicCurve<SheetPosition>;
    if (segment.type === 'arc-cubic') {
      curveBefore = {
        start: prevSegment.point,
        controlPointA: segment.controlPointA,
        controlPointB: segment.controlPointB,
        end: segment.point,
      };
    } else if (segment.type === 'arc-quadratic') {
      curveBefore = {
        start: prevSegment.point,
        controlPoint: segment.controlPoint,
        end: segment.point,
      };
    } else {
      curveBefore = {
        start: prevSegment.point,
        end: segment.point,
      };
    }

    const curvePortionBefore = this.buildShortenedCurve(curveBefore, 0, t);
    const curvePortionAfter = this.buildShortenedCurve(curveBefore, t, 1);

    geometryStore.updatePolygon(polygonId, (old) => {
      const points = [...old.points];

      if (isCubicCurve(curvePortionBefore) && isCubicCurve(curvePortionAfter)) {
        const beforeSegment: CubicBezierSegment = {
          type: 'arc-cubic',
          point: curvePortionBefore.end,
          controlPointA: curvePortionBefore.controlPointA,
          controlPointB: curvePortionBefore.controlPointB,
        };
        const afterSegment: CubicBezierSegment = {
          type: 'arc-cubic',
          point: curvePortionAfter.end,
          controlPointA: curvePortionAfter.controlPointA,
          controlPointB: curvePortionAfter.controlPointB,
        };
        // Note: curvePortionBefore.end = intersectionPoint, so don't include intersectionPoint explicitly
        points.splice(segmentIndex, 1, beforeSegment, afterSegment);
      } else if (isQuadraticCurve(curvePortionBefore) && isQuadraticCurve(curvePortionAfter)) {
        const beforeSegment: QuadraticBezierSegment = {
          type: 'arc-quadratic',
          point: curvePortionBefore.end,
          controlPoint: curvePortionBefore.controlPoint,
        };
        const afterSegment: QuadraticBezierSegment = {
          type: 'arc-quadratic',
          point: curvePortionAfter.end,
          controlPoint: curvePortionAfter.controlPoint,
        };
        // Note: curvePortionBefore.end = intersectionPoint, so don't include intersectionPoint explicitly
        points.splice(segmentIndex, 1, beforeSegment, afterSegment);
      } else {
        // Line segment case: only insert shortened segments, not the explicit intersection point
        // curvePortionBefore.end = intersectionPoint, curvePortionAfter.end = original endpoint
        points.splice(
          segmentIndex,
          1,
          { type: 'point', point: curvePortionBefore.end },
          { type: 'point', point: curvePortionAfter.end },
        );
      }

      return { ...old, points };
    });
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentTrimSpit = null;
  }
}
