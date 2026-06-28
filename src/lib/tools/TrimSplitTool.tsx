import { PocketKnifeIcon } from 'lucide-react';
import { type HalfEdge, type VertexId } from '@/lib/dcel';
import {
  Geometry,
  type Id,
  LinkDimensionsComponent,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  RenderOrderComponent,
} from '@/lib/geometry';
import { type DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import {
  CohenSutherland,
  DeCasteljau,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
  distance,
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
          polygon = this.getGeometryStore().getByIdWithComponent(id, PolygonComponent);
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

      this.getGeometryStore().updateByIdWithComponentDirect(polygon.id, PolygonComponent, (old) => {
        const oldData = PolygonComponent.get(old);
        let points = oldData.points.slice();

        const sortedTargets = targets.sort((a, b) => a.segmentIndex - b.segmentIndex);
        for (let i = 0; i < sortedTargets.length; i += 1) {
          const target = sortedTargets[i];
          const segment = oldData.points[target.segmentIndex];
          if (!segment) {
            continue;
          }

          // 2. Split the relevant segment and update the polygon
          if (QuadraticCurve.isQuadraticCurve(target.segment)) {
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
          } else if (CubicCurve.isCubicCurve(target.segment)) {
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

        return PolygonComponent.update(old, { points });
      });
    }

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

    historyManager.applyTransaction('trim-segment', () => {
      for (const shapeId of trimSegment.associatedGeometries) {
        const oldGeometry = geometryStore.getById(shapeId);
        if (oldGeometry === null) {
          continue;
        }

        // Walk the face loop with the trimmed edge excluded, starting from
        // the trimmed segment's origin vertex as recommended.
        const faceLoop = dcelIndex.getFaceLoopExcluding(
          shapeId,
          excludedHeIds,
          trimSegment.pointAId,
        );
        if (faceLoop === null) {
          continue;
        }

        // Save metadata from old geometry before deletion
        const renderOrder = (oldGeometry as Geometry<RenderOrderComponent>).components.renderOrder;
        const hasLinkDimensions = Geometry.hasComponent(oldGeometry, LinkDimensionsComponent);
        const linkDimensions = hasLinkDimensions
          ? LinkDimensionsComponent.get(oldGeometry)
          : undefined;

        // Convert face loop to polygon points BEFORE deleting the geometry,
        // since deleteByIdDirect releases DCEL vertices which makes
        // getPosition() return undefined for unshared vertices.
        if (faceLoop.length < 2) {
          geometryStore.deleteByIdDirect(shapeId);
          continue;
        }
        const points = this._faceLoopToPolygonPoints(faceLoop, dcelIndex);
        if (points.length < 2) {
          geometryStore.deleteByIdDirect(shapeId);
          continue;
        }

        geometryStore.deleteByIdDirect(shapeId);

        // After excluding an edge the face loop is an open chain
        const polygonTemplate = Polygon.create(points, {
          closed: false,
          openAtIndex: 0,
        });

        const newComponents: Record<string, unknown> = {
          ...polygonTemplate.components,
          ...RenderOrderComponent.create(renderOrder),
        };

        if (typeof linkDimensions !== 'undefined') {
          newComponents.linkDimensions = linkDimensions;
        }

        geometryStore.addDirect({
          id: shapeId,
          components: newComponents,
        } as Geometry);
      }

      this.currentTrimSpit = null;
      this.emit('splitPointOrTrimSegmentChange', null);
    });
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
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
   */
  private _faceLoopToPolygonPoints(
    faceLoop: Array<HalfEdge>,
    dcelIndex: DCELShapeIndex,
  ): Array<PolygonSegment> {
    const points: Array<PolygonSegment> = [];
    const dcel = dcelIndex.dcel;

    for (const he of faceLoop) {
      const originPos = dcel.getPosition(he.originId);
      if (typeof originPos === 'undefined') {
        continue;
      }

      const twinHe = he.twinId !== null ? dcel.getHalfEdge(he.twinId) : undefined;
      let curveCtx;
      if (typeof twinHe !== 'undefined') {
        curveCtx = dcelIndex.getCurveContext(he.originId, twinHe.originId);
      }

      if (typeof curveCtx !== 'undefined') {
        switch (curveCtx.type) {
          case 'quadratic':
            points.push({
              type: 'arc-quadratic',
              point: originPos,
              controlPoint: curveCtx.controlPoint,
            });
            continue;
          case 'cubic':
            points.push({
              type: 'arc-cubic',
              point: originPos,
              controlPointA: curveCtx.controlPointA,
              controlPointB: curveCtx.controlPointB,
            });
            continue;
        }
      }

      points.push({ type: 'point', point: originPos });
    }

    return points;
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentTrimSpit = null;
  }
}
