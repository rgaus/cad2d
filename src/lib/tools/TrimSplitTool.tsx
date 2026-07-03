import { PocketKnifeIcon } from 'lucide-react';
import { type HalfEdge, type VertexId } from '@/lib/dcel';
import { type Id, Polygon, type Geometry, PolygonComponent, type PolygonSegment } from '@/lib/geometry';
import { type DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  CohenSutherland,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
  distance,
  proximityBoundingBox,
} from '@/lib/math';
import { PRESET_COLORS_BY_LABEL } from '../geometry/colors';
import { Intersection } from '../math/intersection';
import { SHEET_UNITS_TO_PIXELS } from '../sheet/Sheet';
import {
  CubicCurve,
  LineSegment,
  QuadraticCurve,
  ScreenPosition,
  SheetPosition,
  ViewportState,
} from '../viewport/types';
import { BaseTool } from './BaseTool';
import { UndoEntry } from '../history/types';

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
    type: 'polygon' | 'rectangle' | 'ellipse' | 'datum';
    /** The index of the segment in the shape's points array. */
    segmentIndex: number;

    segment: CubicCurve<SheetPosition> | LineSegment<SheetPosition> | QuadraticCurve<SheetPosition>;

    /** The split ratio (t parameter) for curve splitting. */
    splitRatio: number;
  }>;
};

export type TrimSegment = {
  type: 'trim-segment';
  /** The DCEL sub-segment that will be trimmed (for preview rendering). */
  trimmedSegment:
    | CubicCurve<SheetPosition>
    | LineSegment<SheetPosition>
    | QuadraticCurve<SheetPosition>;
  /** Closest point to the cursor on the trimmed segment (for preview rendering). */
  nearestCursorPoint: SheetPosition;
  /** DCEL vertex IDs of the trimmed edge's endpoints. Used on click to resolve
   *  the excluded half-edge IDs for the face loop walk. */
  pointAId: VertexId;
  pointBId: VertexId;
  /** All shape IDs that share this DCEL edge. Each will be replaced. */
  associatedGeometries: Array<Id>;
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

  label = 'Trim / Split';
  get icon(): React.ReactNode {
    return <PocketKnifeIcon size={24} color="white" />;
  }

  /** Current intersection data if found, null otherwise. */
  private currentTrimSpit: SplitPoint | TrimSegment | null = null;

  handleMouseDown(): void {
    switch (this.currentTrimSpit?.type) {
      case 'split-point':
        return this.processCurrentIntersection();
      case 'trim-segment':
        return this.processCurrentTrim();
    }
  }

  processCurrentIntersection() {
    if (this.currentTrimSpit?.type !== 'split-point') {
      return;
    }

    const geometryStore = this.getGeometryStore();
    const intersectionPoint = this.currentTrimSpit.point;
    const targets = this.currentTrimSpit.targets;

    // Go shape by shape and apply all splits
    const targetsByShapeId = new Map<string, SplitPoint['targets']>();
    for (const target of targets) {
      const shapeTargets = targetsByShapeId.get(target.id) ?? [];
      targetsByShapeId.set(target.id, [...shapeTargets, target]);
    }

    this.getHistoryManager().applyTransaction('split-point', () => {
      for (const [id, shapeTargets] of targetsByShapeId.entries()) {
        const allHistoryEvents: Array<UndoEntry> = [];

        const targetType = shapeTargets[0].type;
        let polygon: Geometry<PolygonComponent>;
        switch (targetType) {
          case 'polygon':
            const found = geometryStore.getByIdWithComponent(id, PolygonComponent);
            if (!found) {
              continue;
            }
            polygon = found;
            break;
          case 'ellipse':
            polygon = geometryStore.convertEllipseToPolygon(id);
            break;
          case 'rectangle':
            polygon = geometryStore.convertRectangleToPolygon(id);
            break;
          case 'datum':
            // Datums cannot be split, they only have one point!
            continue;
          default:
            targetType satisfies never;
            throw new Error(`TrimSplitTool.processCurrentIntersection: unknown targetType of ${targetType}`);
        }
        if (!polygon) {
          continue;
        }

        // Look up constraints that reference this polygon
        const currentConstraints = geometryStore.findConstraintsByGeometryId(polygon.id);

        // Deduplicate targets by segmentIndex and sort descending (process right-to-left)
        // so earlier insertions do not shift indices for later targets.
        const seenIndices = new Set<number>();
        const uniqueTargets: SplitPoint['targets'] = [];
        for (const t of shapeTargets) {
          if (!seenIndices.has(t.segmentIndex)) {
            seenIndices.add(t.segmentIndex);
            uniqueTargets.push(t);
          }
        }
        uniqueTargets.sort((a, b) => b.segmentIndex - a.segmentIndex);

        for (const target of uniqueTargets) {
          const result = PolygonComponent.addPointOnEdge(
            polygon,
            currentConstraints,
            target.segmentIndex,
            intersectionPoint,
            target.splitRatio,
          );
          if (!result) {
            continue;
          }
          polygon = result.geometry;

          // Merge updated constraints into currentConstraints for subsequent iterations
          for (const updated of result.updatedConstraints) {
            const idx = currentConstraints.findIndex((c) => c.id === updated.id);
            if (idx >= 0) {
              currentConstraints[idx] = updated;
            }
          }
          allHistoryEvents.push(...result.updatedConstraintHistoryEvents);
        }

        this.getGeometryStore().updateById(polygon.id, polygon);

        // Apply constraint updates (deduplicate by constraint ID)
        for (const event of allHistoryEvents) {
          this.getHistoryManager().apply(event);
        }
      }
    });

    this.currentTrimSpit = null;
    this.emit('splitPointOrTrimSegmentChange', null);
  }

  processCurrentTrim() {
    if (this.currentTrimSpit?.type !== 'trim-segment') {
      return;
    }
    const trimSegment = this.currentTrimSpit;

    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();
    const dcelIndex = geometryStore.dcelIndex;
    const dcel = dcelIndex.dcel;

    // Resolve the two half-edge IDs for the trimmed DCEL edge
    const cachedPair = dcel.getCachedEdgePair(trimSegment.pointAId, trimSegment.pointBId);
    if (typeof cachedPair === 'undefined') {
      return;
    }
    const excludedHeIds = [cachedPair.originToDest, cachedPair.destToOrigin];
    const excludeSet = new Set(excludedHeIds);
    const excludedEdgeKey = dcel.getEdgeKey(trimSegment.pointAId, trimSegment.pointBId);

    // Collect all affected shapes: edge owners + vertex sharers
    const affectedShapeIds = new Set(trimSegment.associatedGeometries);
    for (const result of dcelIndex.computeShapesForVertexId(trimSegment.pointAId)) {
      affectedShapeIds.add(result.id);
    }
    for (const result of dcelIndex.computeShapesForVertexId(trimSegment.pointBId)) {
      affectedShapeIds.add(result.id);
    }

    const shapeIds = Array.from(affectedShapeIds);

    // Walk the combined boundary across all affected shapes.
    // Start from pointAId first; if that fails (e.g. the only outgoing
    // edge at pointAId is the excluded edge itself), retry from pointBId.
    let boundary = dcelIndex.walkCombinedBoundary(shapeIds, excludedHeIds, trimSegment.pointAId);
    if (boundary === null) {
      boundary = dcelIndex.walkCombinedBoundary(shapeIds, excludedHeIds, trimSegment.pointBId);
    }

    if (boundary === null || boundary.result.length < 1) {
      // Combined boundary is degenerate - bail out early.
      return;
    }

    // Build a set of edge keys from the combined boundary for fast lookup.
    // We use edge keys (canonical origin↔dest) rather than half-edge IDs
    // because the boundary may use the twin of a loop edge in the face loop.
    const boundaryEdgeKeys = new Set<string>();
    for (const he of boundary.result) {
      if (he.twinId !== null) {
        const twin = dcel.getHalfEdge(he.twinId);
        if (typeof twin !== 'undefined') {
          boundaryEdgeKeys.add(dcel.getEdgeKey(he.originId, twin.originId));
        }
      }
    }

    // For each affected shape, partition its full face loop into
    // offcut runs (edges NOT in the combined boundary) and create
    // open polygons for each offcut run.
    const offcutPolygons: Array<{ points: Array<PolygonSegment> }> = [];
    for (const sid of shapeIds) {
      const fullLoop = dcelIndex.getShapeFaceLoop(sid);
      if (fullLoop === null) {
        continue;
      }

      let currentRun: Array<HalfEdge> = [];
      const flushRun = () => {
        if (currentRun.length === 0) {
          return;
        }
        const pts = this._faceLoopToPolygonPoints(currentRun, dcelIndex);
        if (pts.length >= 2) {
          offcutPolygons.push({ points: pts });
        }
        currentRun = [];
      };

      for (const he of fullLoop) {
        // Compute the edge key for this half-edge
        const twin = he.twinId !== null ? dcel.getHalfEdge(he.twinId) : undefined;
        let edgeKey: string | undefined;
        if (typeof twin !== 'undefined') {
          edgeKey = dcel.getEdgeKey(he.originId, twin.originId);
        }

        const inBoundary = typeof edgeKey !== 'undefined' && boundaryEdgeKeys.has(edgeKey);
        const isExcluded = typeof edgeKey !== 'undefined' && edgeKey === excludedEdgeKey;

        if (isExcluded) {
          // The trimmed edge — skip entirely, flush any collected run
          flushRun();
        } else if (inBoundary) {
          // Edge is in the combined boundary — flush any collected run
          flushRun();
        } else {
          // Edge is NOT in the boundary — collect for offcut
          currentRun.push(he);
        }
      }
      // Handle remaining run (wraparound)
      flushRun();
    }
    console.log('OFFCUT', offcutPolygons);

    const mainPoints = this._faceLoopToPolygonPoints(boundary.result, dcelIndex);

    historyManager.applyTransaction('trim-segment', () => {
      // Delete all original geometries
      for (const sid of shapeIds) {
        geometryStore.deleteById(sid);
      }

      // Create the combined boundary polygon
      const mainPolygon = Polygon.create(mainPoints, {
        closed: boundary.isClosed,
        fillColor: PRESET_COLORS_BY_LABEL['purple-light'],
      });
      geometryStore.add(ID_PREFIXES.polygon, mainPolygon);

      // Create offcut polygons
      for (const offcut of offcutPolygons) {
        const offcutPolygon = Polygon.create(offcut.points, { closed: false });
        geometryStore.add(ID_PREFIXES.polygon, offcutPolygon);
      }
    });

    this.currentTrimSpit = null;
    this.emit('splitPointOrTrimSegmentChange', null);
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const sheetPos = screenPos.toWorld(viewport).toSheet();
    const sheetThreshold =
      DEFAULT_PIXEL_BOUNDING_BOX_THRESHOLD_PX / SHEET_UNITS_TO_PIXELS / viewport.scale;
    this.currentTrimSpit = null;

    const intersection = this.computeIntersectionAtPoint(sheetPos, sheetThreshold, viewport);
    if (intersection) {
      this.currentTrimSpit = intersection;
      this.emit('splitPointOrTrimSegmentChange', intersection);
      return;
    }

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
      shapeType: 'polygon' | 'rectangle' | 'ellipse' | 'datum';
      segmentIndex: number;
      segment:
        | LineSegment<SheetPosition>
        | QuadraticCurve<SheetPosition>
        | CubicCurve<SheetPosition>;
    }> = [];

    for (const shape of allGeometry) {
      for (const { index, segment } of shape.segments) {
        let mightIntersect = false;

        if (CubicCurve.isCubicCurve(segment)) {
          mightIntersect = true; //CohenSutherland.cubicCurveMightIntersectBoundingBox(segment, searchBox);
        } else if (QuadraticCurve.isQuadraticCurve(segment)) {
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
      shapeType: 'polygon' | 'rectangle' | 'ellipse' | 'datum';
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
    const dcelIndex = this.getGeometryStore().dcelIndex;
    const nearest = dcelIndex.queryNearestSegment(mousePos, true, {
      maxDistance: threshold,
    });
    if (!nearest) {
      return null;
    }

    // Compute the closest point on the segment to the cursor for the preview
    let nearestCursorPoint: SheetPosition;
    if (CubicCurve.isCubicCurve(nearest.segment)) {
      nearestCursorPoint = closestPointOnCubicCurve(nearest.segment, mousePos).point;
    } else if (QuadraticCurve.isQuadraticCurve(nearest.segment)) {
      nearestCursorPoint = closestPointOnQuadraticCurve(nearest.segment, mousePos).point;
    } else {
      nearestCursorPoint = closestPointOnSegment(
        nearest.segment.start,
        nearest.segment.end,
        mousePos,
      ).point;
    }

    return {
      type: 'trim-segment',
      trimmedSegment: nearest.segment,
      nearestCursorPoint,
      pointAId: nearest.pointAId,
      pointBId: nearest.pointBId,
      associatedGeometries: nearest.associatedGeometries,
    };
  }

  /**
   * Convert an ordered list of DCEL half-edges (from walkFaceLoop) into an
   * array of polygon segments suitable for {@link Polygon.create}.
   *
   * When edges were excluded from the face loop, this method reconstructs
   * the "gap" vertices (origins of excluded edges between included edges)
   * and appends the destination of the last edge when the result is open
   * rather than closed.
   */
  private _faceLoopToPolygonPoints(
    faceLoop: Array<HalfEdge>,
    dcelIndex: DCELShapeIndex,
  ): Array<PolygonSegment> {
    const points: Array<PolygonSegment> = [];
    const dcel = dcelIndex.dcel;

    if (faceLoop.length === 0) {
      return [];
    }

    // First pass: push all origin positions as plain points.
    for (let i = 0; i < faceLoop.length; i += 1) {
      const he = faceLoop[i];
      const originPos = dcel.getPosition(he.originId);
      if (originPos) {
        points.push({ type: 'point', point: originPos });
      }
    }

    // Second pass: apply curve contexts. Edge i (from faceLoop[i])
    // goes from vertex[i] to vertex[i+1] — the curve belongs on
    // segment i+1 (the segment ending at vertex[i+1]).
    // Save the last non-null context for the open-loop destination.
    let lastCurveCtx:
      | { type: 'quadratic'; controlPoint: SheetPosition }
      | { type: 'cubic'; controlPointA: SheetPosition; controlPointB: SheetPosition }
      | undefined;

    for (let i = 0; i < faceLoop.length; i += 1) {
      const he = faceLoop[i];
      if (he.twinId === null) {
        continue;
      }
      const twinHe = dcel.getHalfEdge(he.twinId);
      if (typeof twinHe === 'undefined') {
        continue;
      }
      const curveCtx = dcelIndex.getCurveContext(he.originId, twinHe.originId);
      if (typeof curveCtx === 'undefined') {
        continue;
      }

      // Map the curve onto the segment that ENDS at the destination of this edge
      // (index i+1 in the points array).
      const targetIdx = i + 1;
      if (targetIdx < points.length) {
        points[targetIdx] = this._makeCurveSegment(curveCtx, points[targetIdx].point);
      }

      if (i === faceLoop.length - 1) {
        lastCurveCtx = curveCtx;
      }
    }

    // When the face loop is open (edges were excluded), the last edge's
    // destination differs from the first edge's origin. Add it as the
    // final polygon point so the open chain is complete.
    if (faceLoop.length > 0) {
      const lastHe = faceLoop[faceLoop.length - 1];
      if (lastHe.twinId !== null) {
        const twin = dcel.getHalfEdge(lastHe.twinId);
        if (typeof twin !== 'undefined') {
          const destPos = dcel.getPosition(twin.originId);
          if (typeof destPos !== 'undefined') {
            const firstPt = points[0]?.point;
            if (
              typeof firstPt === 'undefined' ||
              Math.abs(destPos.x - firstPt.x) > 0.001 ||
              Math.abs(destPos.y - firstPt.y) > 0.001
            ) {
              if (typeof lastCurveCtx !== 'undefined') {
                points.push(this._makeCurveSegment(lastCurveCtx, destPos));
              } else {
                points.push({ type: 'point', point: destPos });
              }
            }
          }
        }
      }
    }

    return points;
  }

  private _makeCurveSegment(
    curveCtx:
      | { type: 'quadratic'; controlPoint: SheetPosition }
      | { type: 'cubic'; controlPointA: SheetPosition; controlPointB: SheetPosition },
    point: SheetPosition,
  ): PolygonSegment {
    if (curveCtx.type === 'quadratic') {
      return {
        type: 'arc-quadratic',
        point,
        controlPoint: curveCtx.controlPoint,
      };
    }
    return {
      type: 'arc-cubic',
      point,
      controlPointA: curveCtx.controlPointA,
      controlPointB: curveCtx.controlPointB,
    };
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentTrimSpit = null;
  }
}
