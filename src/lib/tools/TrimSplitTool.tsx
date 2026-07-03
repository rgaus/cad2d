import { PocketKnifeIcon } from 'lucide-react';
import DCEL, { type HalfEdge, type VertexId } from '@/lib/dcel';
import {
  ColinearConstraint,
  Constraint,
  ConstraintEndpoint,
  Datum,
  EllipseComponent,
  FillColorComponent,
  type Geometry,
  type Id,
  Polygon,
  PolygonComponent,
  PolygonSegment,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { type DCELShapeIndex } from '@/lib/geometry/DCELShapeIndex';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import {
  BoundingBox,
  CohenSutherland,
  Vector2,
  closestPointOnCubicCurve,
  closestPointOnQuadraticCurve,
  closestPointOnSegment,
} from '@/lib/math';
import { Intersection } from '@/lib/math';
import { DEFAULT_COLOR, PRESET_COLORS_BY_LABEL } from '../geometry/colors';
import { UndoEntry } from '../history/types';
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

/** Identifies a single constraint endpoint that references a removed vertex during trimming. */
type RemovedConstraintEndpoint = {
  constraintId: Id;
  key: string;
};

/** Information about an original vertex that is being removed by a trim operation
 *  and has constraints attached to it. */
type RemovedVertexInfo = {
  position: SheetPosition;
  constraintEndpoints: Array<RemovedConstraintEndpoint>;
  survivingNeighbors: Array<SheetPosition>;
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
            throw new Error(
              `TrimSplitTool.processCurrentIntersection: unknown targetType of ${targetType}`,
            );
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
            target.segmentIndex - 1,
            { type: 't', t: target.splitRatio },
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
    let firstFillColor: FillColorComponent[keyof FillColorComponent] | undefined = undefined;
    let firstRenderOrder: RenderOrderComponent[keyof RenderOrderComponent] | undefined = undefined;
    for (const result of dcelIndex.computeShapesForVertexId(trimSegment.pointAId)) {
      affectedShapeIds.add(result.id);

      const fillColorGeometry = geometryStore.getByIdWithComponent(result.id, FillColorComponent);
      if (fillColorGeometry) {
        firstFillColor = FillColorComponent.get(fillColorGeometry);
      }
      const renderOrderGeometry = geometryStore.getByIdWithComponent(
        result.id,
        RenderOrderComponent,
      );
      if (renderOrderGeometry) {
        firstRenderOrder = RenderOrderComponent.get(renderOrderGeometry);
      }
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

    // Build set of boundary vertex positions so we can detect which original vertices are removed
    const boundaryPositions = this._buildBoundaryPositions(boundary.result, dcel);

    // Identify removed vertices that have constraints attached
    const removedVertexInfo = this._computeRemovedVertexInfo(shapeIds, boundaryPositions);

    historyManager.applyTransaction('trim-segment', () => {
      // Phase 0: Re-attach constraints on removed vertices to newly created datums.
      // By rewriting the endpoints to locked-datum BEFORE deleting the old shapes,
      // those constraints are no longer found by findConstraintsByGeometryId and
      // survive the cascade delete.
      const datumColinearInfo: Array<{
        datumId: Id;
        position: SheetPosition;
        survivingNeighbors: Array<SheetPosition>;
      }> = [];
      const datumCache = new Map<string, Id>();

      for (const info of removedVertexInfo) {
        const posKey = `${info.position.x}_${info.position.y}`;
        let datumId = datumCache.get(posKey);
        if (typeof datumId === 'undefined') {
          const datumGeo = geometryStore.add(ID_PREFIXES.datum, Datum.create(info.position));
          datumId = datumGeo.id;
          datumCache.set(posKey, datumId);
        }

        for (const ep of info.constraintEndpoints) {
          geometryStore.updateConstraint(ep.constraintId, (existing) => ({
            ...(existing as any),
            [ep.key]: ConstraintEndpoint.lockedToDatum(datumId),
          }));
        }

        datumColinearInfo.push({
          datumId,
          position: info.position,
          survivingNeighbors: info.survivingNeighbors,
        });
      }

      // Delete all original geometries (constraints already re-attached to datums
      // won't be found by the cascade delete in deleteById).
      for (const sid of shapeIds) {
        geometryStore.deleteById(sid);
      }

      // Create the combined boundary polygon
      const mainPolygonAlreadyExists = geometryStore
        .listWithComponent(PolygonComponent)
        .find((geometry) => {
          return PolygonComponent.get(geometry).points.every((p, i) =>
            PolygonSegment.equals(p, mainPoints[i]),
          );
        });
      let mainPolygonId: Id | undefined;
      if (!mainPolygonAlreadyExists) {
        const mainPolygon = Polygon.create(mainPoints, {
          closed: boundary.isClosed,
          fillColor: firstFillColor ?? DEFAULT_COLOR,
        });
        const mainGeo = geometryStore.add(ID_PREFIXES.polygon, mainPolygon, {
          renderOrder: firstRenderOrder,
        });
        mainPolygonId = mainGeo.id;
      }

      // Create offcut polygons
      for (const offcut of offcutPolygons) {
        const offcutPolygon = Polygon.create(offcut.points, { closed: false });
        geometryStore.add(ID_PREFIXES.polygon, offcutPolygon);
      }

      // Phase 1: Add colinear constraints linking each datum to the shortened
      // edges that replaced the removed vertex's adjacent edges.
      if (typeof mainPolygonId !== 'undefined') {
        this._addColinearConstraints(datumColinearInfo, mainPolygonId, mainPoints);
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

    const searchBox = BoundingBox.proximity(mousePos, threshold);
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
    //     const d = Vector2.distance(c.point, mousePos);
    //     console.log('    shape:', c.shapeId, 'segment:', c.segmentIndex, 'point:', c.point.x, c.point.y, 'dist:', d);
    //   }
    // }

    for (const group of pointGroups.values()) {
      if (group.length < 2) {
        // console.log('Skipping group length < 2:', group.length);
        continue;
      }

      const dist = Vector2.distance(group[0].point, mousePos);
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

  /**
   * Build a set of unique vertex position keys from the boundary half-edges
   * returned by {@link DCELShapeIndex#walkCombinedBoundary}. Used to
   * detect which original vertices are no longer present in the trimmed result.
   */
  private _buildBoundaryPositions(
    boundaryHalfEdges: Array<HalfEdge>,
    dcel: DCEL<SheetPosition>,
  ): Set<string> {
    const positions = new Set<string>();
    for (const he of boundaryHalfEdges) {
      const pos = dcel.getPosition(he.originId);
      if (typeof pos !== 'undefined') {
        positions.add(`${pos.x}_${pos.y}`);
      }
    }
    if (boundaryHalfEdges.length > 0) {
      const lastHe = boundaryHalfEdges[boundaryHalfEdges.length - 1];
      if (lastHe.twinId !== null) {
        const twin = dcel.getHalfEdge(lastHe.twinId);
        if (typeof twin !== 'undefined') {
          const pos = dcel.getPosition(twin.originId);
          if (typeof pos !== 'undefined') {
            positions.add(`${pos.x}_${pos.y}`);
          }
        }
      }
    }
    return positions;
  }

  /**
   * For each affected shape, find vertices that are being removed by the trim
   * (position not present in the new boundary) and that have constraint
   * endpoints locked to them. Returns the collected info so constraints can be
   * re-attached to datums and colinear constraints can be created.
   */
  private _computeRemovedVertexInfo(
    shapeIds: Array<Id>,
    boundaryPositions: Set<string>,
  ): Array<RemovedVertexInfo> {
    const geometryStore = this.getGeometryStore();
    const results: Array<RemovedVertexInfo> = [];

    const posInBoundary = (pos: SheetPosition): boolean => {
      return boundaryPositions.has(`${pos.x}_${pos.y}`);
    };

    for (const sid of shapeIds) {
      const shapeConstraints = geometryStore.findConstraintsByGeometryId(sid);
      if (shapeConstraints.length === 0) {
        continue;
      }

      // ── Polygon ──────────────────────────────────────────────
      const polygon = geometryStore.getByIdWithComponent(sid, PolygonComponent);
      if (polygon !== null) {
        const points = PolygonComponent.get(polygon).points;
        const len = points.length;

        for (let i = 0; i < len; i += 1) {
          const pos = points[i].point;
          if (posInBoundary(pos)) {
            continue;
          }

          const constraintEndpoints = this._findConstraintEndpointsForPolygon(
            shapeConstraints,
            sid,
            i,
          );
          if (constraintEndpoints.length === 0) {
            continue;
          }

          const survivingNeighbors: Array<SheetPosition> = [];
          const leftIdx = (i - 1 + len) % len;
          if (leftIdx !== i) {
            const leftPos = points[leftIdx].point;
            if (posInBoundary(leftPos)) {
              survivingNeighbors.push(leftPos);
            }
          }
          const rightIdx = (i + 1) % len;
          if (rightIdx !== i) {
            const rightPos = points[rightIdx].point;
            if (posInBoundary(rightPos)) {
              survivingNeighbors.push(rightPos);
            }
          }

          results.push({ position: pos, constraintEndpoints, survivingNeighbors });
        }
        continue;
      }

      // ── Rectangle ───────────────────────────────────────────
      const rectangle = geometryStore.getByIdWithComponent(sid, RectangleComponent);
      if (rectangle !== null) {
        const kp = RectangleComponent.keyPoints(rectangle);
        const perimeterLabels = kp.perimeterLabels as ReadonlyArray<string>;
        const perimeterPositions = kp.perimeter;
        const numCorners = perimeterPositions.length;

        for (let i = 0; i < numCorners; i += 1) {
          const pos = perimeterPositions[i];
          if (posInBoundary(pos)) {
            continue;
          }

          const label = perimeterLabels[i];
          const constraintEndpoints = this._findConstraintEndpointsForRectangleOrEllipse(
            shapeConstraints,
            sid,
            label,
          );
          if (constraintEndpoints.length === 0) {
            continue;
          }

          const survivingNeighbors: Array<SheetPosition> = [];
          const leftIdx = (i - 1 + numCorners) % numCorners;
          if (leftIdx !== i) {
            const leftPos = perimeterPositions[leftIdx];
            if (posInBoundary(leftPos)) {
              survivingNeighbors.push(leftPos);
            }
          }
          const rightIdx = (i + 1) % numCorners;
          if (rightIdx !== i) {
            const rightPos = perimeterPositions[rightIdx];
            if (posInBoundary(rightPos)) {
              survivingNeighbors.push(rightPos);
            }
          }

          results.push({ position: pos, constraintEndpoints, survivingNeighbors });
        }
        continue;
      }

      // ── Ellipse ─────────────────────────────────────────────
      const ellipse = geometryStore.getByIdWithComponent(sid, EllipseComponent);
      if (ellipse !== null) {
        const kp = EllipseComponent.keyPoints(ellipse);
        const perimeterLabels = kp.perimeterLabels as ReadonlyArray<string>;
        const perimeterPositions = kp.perimeter;
        const numPoints = perimeterPositions.length;

        for (let i = 0; i < numPoints; i += 1) {
          const pos = perimeterPositions[i];
          if (posInBoundary(pos)) {
            continue;
          }

          const label = perimeterLabels[i];
          const constraintEndpoints = this._findConstraintEndpointsForRectangleOrEllipse(
            shapeConstraints,
            sid,
            label,
          );
          if (constraintEndpoints.length === 0) {
            continue;
          }

          const survivingNeighbors: Array<SheetPosition> = [];
          const leftIdx = (i - 1 + numPoints) % numPoints;
          if (leftIdx !== i) {
            const leftPos = perimeterPositions[leftIdx];
            if (posInBoundary(leftPos)) {
              survivingNeighbors.push(leftPos);
            }
          }
          const rightIdx = (i + 1) % numPoints;
          if (rightIdx !== i) {
            const rightPos = perimeterPositions[rightIdx];
            if (posInBoundary(rightPos)) {
              survivingNeighbors.push(rightPos);
            }
          }

          results.push({ position: pos, constraintEndpoints, survivingNeighbors });
        }
        continue;
      }
    }

    return results;
  }

  /**
   * Find constraint endpoints that reference a specific polygon vertex
   * (shapeId + pointIndex) via locked-polygon endpoints.
   */
  private _findConstraintEndpointsForPolygon(
    constraints: Array<Constraint>,
    shapeId: Id,
    pointIndex: number,
  ): Array<RemovedConstraintEndpoint> {
    const result: Array<RemovedConstraintEndpoint> = [];
    for (const c of constraints) {
      const keys = Constraint.getPositionKeys(c);
      for (const key of keys) {
        const ep = (c as any)[key] as ConstraintEndpoint;
        if (ep.type === 'locked-polygon' && ep.id === shapeId && ep.pointIndex === pointIndex) {
          result.push({ constraintId: c.id, key });
        }
      }
    }
    return result;
  }

  /**
   * Find constraint endpoints that reference a specific rectangle or ellipse
   * key point (shapeId + label) via locked-rectangle or locked-ellipse endpoints.
   */
  private _findConstraintEndpointsForRectangleOrEllipse(
    constraints: Array<Constraint>,
    shapeId: Id,
    label: string,
  ): Array<RemovedConstraintEndpoint> {
    const result: Array<RemovedConstraintEndpoint> = [];
    for (const c of constraints) {
      const keys = Constraint.getPositionKeys(c);
      for (const key of keys) {
        const ep = (c as any)[key] as ConstraintEndpoint;
        if (
          (ep.type === 'locked-rectangle' || ep.type === 'locked-ellipse') &&
          ep.id === shapeId &&
          ep.point === label
        ) {
          result.push({ constraintId: c.id, key });
        }
      }
    }
    return result;
  }

  /**
   * For each removed vertex that had constraints re-attached to a datum,
   * create a colinear constraint between the datum and each shortened
   * straight-line edge that survived in the new boundary polygon.
   */
  private _addColinearConstraints(
    datumColinearInfo: Array<{
      datumId: Id;
      position: SheetPosition;
      survivingNeighbors: Array<SheetPosition>;
    }>,
    mainPolygonId: Id,
    mainPoints: Array<PolygonSegment>,
  ): void {
    const geometryStore = this.getGeometryStore();
    const mainLen = mainPoints.length;

    for (const info of datumColinearInfo) {
      for (const neighborPos of info.survivingNeighbors) {
        let neighborIdx = -1;
        for (let j = 0; j < mainLen; j += 1) {
          const pt = mainPoints[j].point;
          if (pt.x === neighborPos.x && pt.y === neighborPos.y) {
            neighborIdx = j;
            break;
          }
        }
        if (neighborIdx < 0) {
          continue;
        }

        // Check both adjacent edges in the closed polygon for colinearity
        for (const adj of [(neighborIdx - 1 + mainLen) % mainLen, (neighborIdx + 1) % mainLen]) {
          if (adj === neighborIdx) {
            continue;
          }

          const adjPt = mainPoints[adj].point;

          // Determine which index holds the segment type for the edge
          // between neighborIdx and adj.
          // Edge neighborIdx -> rightAdj: segment type stored at rightAdj.
          // Edge leftAdj -> neighborIdx: segment type stored at neighborIdx.
          const rightAdj = (neighborIdx + 1) % mainLen;
          const segmentTypeIdx = adj === rightAdj ? adj : neighborIdx;

          // Skip curved edges (only straight lines make sense for colinear constraints)
          if (mainPoints[segmentTypeIdx].type !== 'point') {
            continue;
          }

          // Check colinearity: cross product of (adjPt - neighborPos) and
          // (datum position - neighborPos) should be ~0.
          const cross =
            (adjPt.x - neighborPos.x) * (info.position.y - neighborPos.y) -
            (adjPt.y - neighborPos.y) * (info.position.x - neighborPos.x);

          if (Math.abs(cross) > 1e-6) {
            continue;
          }

          geometryStore.addConstraint(
            ColinearConstraint.create(
              ConstraintEndpoint.lockedToDatum(info.datumId),
              ConstraintEndpoint.lockedToPolygon(mainPolygonId, neighborIdx),
              ConstraintEndpoint.lockedToPolygon(mainPolygonId, adj),
            ),
          );
        }
      }
    }
  }

  /** Resets the tool state for testing. */
  resetForTesting(): void {
    this.currentTrimSpit = null;
  }
}
