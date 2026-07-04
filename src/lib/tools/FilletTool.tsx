import { SquareRoundCornerIcon } from 'lucide-react';
import {
  ColinearConstraint,
  Constraint,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  EllipseComponent,
  type Id,
  PolygonComponent,
  RectangleComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { type GeometryStore } from '@/lib/geometry/GeometryStore';
import { type CubicBezierSegment } from '@/lib/geometry/polygon';
import { Vector2, computeFilletArc } from '@/lib/math';
import { applyKeyPointSnapping, applySnapping } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';
import { type PendingFilletState } from './types';

export type FilletToolEvents = {
  previewSheetPositionChange: (
    data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null,
  ) => void;
  pendingFilletChange: (state: PendingFilletState | null) => void;
};

type FilletToolState =
  | { type: 'idle' }
  | {
      type: 'placing-pointa';
      geometryId: Id;
      centerEndpoint: ConstraintEndpoint;
      centerPos: SheetPosition;
      centerPointIndex: number;
    }
  | {
      type: 'placing-pointb';
      geometryId: Id;
      centerEndpoint: ConstraintEndpoint;
      centerPos: SheetPosition;
      centerPointIndex: number;
      pointAEndpoint: ConstraintEndpoint;
      pointAPointIndex: number;
      segmentIndexA: number;
    }
  | {
      type: 'awaiting-distance';
      pending: PendingFilletState;
    };

/**
 * A tool for creating fillets (rounded corners) on polygon shapes.
 *
 * UX flow:
 * 1. Click a corner vertex (key point on a polygon or rectangle)
 * 2. Click an adjacent vertex on one edge
 * 3. Click an adjacent vertex on the other edge
 * 4. Enter the fillet offset distance in a popup input
 * 5. The corner is replaced with a circular cubic bezier arc
 */
export class FilletCreationTool extends BaseTool<FilletToolEvents, 'fillet'> {
  type = 'fillet' as const;
  label = 'Fillet';

  get icon(): React.ReactNode {
    return <SquareRoundCornerIcon size={24} color="white" />;
  }

  focusKeyCombo = 'f' as const;

  private state: FilletToolState = { type: 'idle' };
  private previewSheetPos: SheetPosition | null = null;

  // Deferred datum creation (same pattern as constraint tools)
  private pendingCenterSnap: {
    shouldCreateDatum: boolean;
    endpoint: ConstraintEndpoint;
  } | null = null;
  private pendingPointASnap: {
    shouldCreateDatum: boolean;
    endpoint: ConstraintEndpoint;
  } | null = null;
  private pendingPointBSnap: {
    shouldCreateDatum: boolean;
    endpoint: ConstraintEndpoint;
  } | null = null;

  handleToolBlur(): void {
    this.state = { type: 'idle' };
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('pendingFilletChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const gridSnapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
    const { endpoint: rawEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      gridSnapped,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
        constraints: geometryStore.constraints,
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    switch (this.state.type) {
      case 'idle': {
        const validated = this.validateCenterEndpoint(rawEndpoint);
        if (!validated) {
          return;
        }
        this.state = {
          type: 'placing-pointa',
          geometryId: validated.geometryId,
          centerEndpoint: rawEndpoint,
          centerPos: validated.centerPos,
          centerPointIndex: validated.centerPointIndex,
        };
        this.pendingCenterSnap = {
          shouldCreateDatum: shouldCreateDatum !== null,
          endpoint: rawEndpoint,
        };
        break;
      }

      case 'placing-pointa': {
        const validated = this.validateAdjacentEndpoint(
          rawEndpoint,
          this.state.geometryId,
          this.state.centerPointIndex,
        );
        if (!validated) {
          return;
        }
        this.state = {
          type: 'placing-pointb',
          geometryId: this.state.geometryId,
          centerEndpoint: this.state.centerEndpoint,
          centerPos: this.state.centerPos,
          centerPointIndex: this.state.centerPointIndex,
          pointAEndpoint: rawEndpoint,
          pointAPointIndex: validated.pointIndex,
          segmentIndexA: validated.segmentIndex,
        };
        this.pendingPointASnap = {
          shouldCreateDatum: shouldCreateDatum !== null,
          endpoint: rawEndpoint,
        };
        break;
      }

      case 'placing-pointb': {
        this.pendingPointBSnap = {
          shouldCreateDatum: shouldCreateDatum !== null,
          endpoint: rawEndpoint,
        };

        const s = this.state;
        const validated = this.validateAdjacentEndpoint(
          rawEndpoint,
          s.geometryId,
          s.centerPointIndex,
          s.pointAPointIndex,
        );
        if (!validated) {
          return;
        }

        const pending: PendingFilletState = {
          geometryId: s.geometryId,
          centerEndpoint: s.centerEndpoint,
          pointAEndpoint: s.pointAEndpoint,
          pointBEndpoint: rawEndpoint,
          centerPos: s.centerPos,
          segmentIndexA: s.segmentIndexA,
          segmentIndexB: validated.segmentIndex,
          centerPointIndex: s.centerPointIndex,
          pointAPointIndex: s.pointAPointIndex,
          pointBPointIndex: validated.pointIndex,
        };
        this.state = { type: 'awaiting-distance', pending };
        this.emit('pendingFilletChange', pending);
        break;
      }
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const gridSnapped = applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
    const { endpoint: keyPointEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      gridSnapped,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
        constraints: geometryStore.constraints,
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    // Update pending snaps for deferred datum creation
    switch (this.state.type) {
      case 'placing-pointa':
        this.pendingPointASnap = {
          shouldCreateDatum: shouldCreateDatum !== null,
          endpoint: keyPointEndpoint,
        };
        break;
      case 'placing-pointb':
        this.pendingPointBSnap = {
          shouldCreateDatum: shouldCreateDatum !== null,
          endpoint: keyPointEndpoint,
        };
        break;
    }

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });
  }

  protected defaultCursor = 'pointer';

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abort();
      return true;
    }
    return false;
  }

  /**
   * Called by the React popup when the user confirms the fillet distance.
   * Executes the full fillet operation inside a history transaction.
   */
  setFilletDistance(distance: Length): void {
    if (this.state.type !== 'awaiting-distance') {
      return;
    }
    const pending = this.state.pending;
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const offset = distance.toSheetUnits(sheet.defaultUnit).magnitude;

    // Validate distance against edge lengths
    const centerPos = pending.centerPos;
    const resolvedA = geometryStore.resolveConstraintEndpoint(pending.pointAEndpoint);
    const resolvedB = geometryStore.resolveConstraintEndpoint(pending.pointBEndpoint);
    if (!resolvedA || !resolvedB) {
      return;
    }
    const lenA = Vector2.dist(centerPos, resolvedA);
    const lenB = Vector2.dist(centerPos, resolvedB);
    if (offset <= 0 || offset >= lenA || offset >= lenB) {
      return;
    }

    historyManager.applyTransaction('fillet', () => {
      this.processFillet(pending, offset);
    });

    this.abort();
  }

  /** Gets the current pending fillet state, or null if not awaiting distance. */
  getPendingFilletState(): PendingFilletState | null {
    if (this.state.type === 'awaiting-distance') {
      return this.state.pending;
    }
    return null;
  }

  private abort(): void {
    this.state = { type: 'idle' };
    this.previewSheetPos = null;
    this.pendingCenterSnap = null;
    this.pendingPointASnap = null;
    this.pendingPointBSnap = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('pendingFilletChange', null);
  }

  /**
   * Validates that an endpoint is a valid polygon or rectangle key point.
   * For rectangles, we accept and will convert later.
   */
  private validateCenterEndpoint(
    endpoint: ConstraintEndpoint,
  ): { geometryId: Id; centerPos: SheetPosition; centerPointIndex: number } | null {
    const gs = this.getGeometryStore();
    const pos = gs.resolveConstraintEndpoint(endpoint);
    if (!pos) {
      return null;
    }

    if (endpoint.type === 'locked-polygon') {
      return { geometryId: endpoint.id, centerPos: pos, centerPointIndex: endpoint.pointIndex };
    }
    if (endpoint.type === 'locked-rectangle') {
      return { geometryId: endpoint.id, centerPos: pos, centerPointIndex: -1 };
    }
    return null;
  }

  /**
   * Validates that an endpoint is adjacent to centerPointIndex on the same polygon.
   * Returns the pointIndex and segmentIndex for the edge to that vertex.
   * segmentIndex is the index of the PolygonSegment entry that is the start of the
   * edge connecting these two points.
   */
  private validateAdjacentEndpoint(
    endpoint: ConstraintEndpoint,
    geometryId: Id,
    centerPointIndex: number,
    excludePointIndex?: number,
  ): { pointIndex: number; segmentIndex: number } | null {
    if (endpoint.type !== 'locked-polygon') {
      return null;
    }
    if (endpoint.id !== geometryId) {
      return null;
    }
    const pointIndex = endpoint.pointIndex;
    if (typeof excludePointIndex !== 'undefined' && pointIndex === excludePointIndex) {
      return null;
    }

    const gs = this.getGeometryStore();
    const polygon = gs.getByIdWithComponent(geometryId, PolygonComponent);
    if (!polygon) {
      return null;
    }
    const polyData = PolygonComponent.get(polygon);
    const n = polyData.points.length;

    // Determine if this point is adjacent to center (±1 modulo n)
    const diffA = mod(pointIndex - centerPointIndex, n);
    const diffB = mod(centerPointIndex - pointIndex, n);

    if (diffA !== 1 && diffB !== 1) {
      return null;
    }

    // If point is after center (diffA === 1), the edge is center -> point,
    // starting at segmentIndex = centerPointIndex
    // If point is before center (diffB === 1), the edge is point -> center,
    // starting at segmentIndex = pointIndex
    const segmentIndex = diffA === 1 ? centerPointIndex : pointIndex;

    return { pointIndex, segmentIndex };
  }

  /** Executes the fillet operation. Must be called inside a history transaction. */
  private processFillet(pending: PendingFilletState, offset: number): void {
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    let geometryId = pending.geometryId;
    let centerPointIndex = pending.centerPointIndex;

    // Step 0: Convert rectangle to polygon if needed
    const geom = geometryStore.getById(geometryId);
    if (geom && 'rectangle' in geom.components) {
      const polygon = geometryStore.convertRectangleToPolygon(geometryId);
      geometryId = polygon.id;
      // After conversion, the center point index may differ. We need to find it by position.
      const newPoly = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
      if (newPoly) {
        const newPoints = PolygonComponent.get(newPoly).points;
        for (let i = 0; i < newPoints.length; i++) {
          if (
            newPoints[i].point.x === pending.centerPos.x &&
            newPoints[i].point.y === pending.centerPos.y
          ) {
            centerPointIndex = i;
            break;
          }
        }
      }
    }

    const polygon = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
    if (!polygon) {
      return;
    }
    const polyData = PolygonComponent.get(polygon);
    const points = polyData.points;

    if (centerPointIndex < 0 || centerPointIndex >= points.length) {
      return;
    }

    // Compute split t values using the CENTER position from the polygon
    const centerPos = points[mod(centerPointIndex, points.length)].point;
    const pointAIndex = mod(pending.pointAPointIndex, points.length);
    const pointBIndex = mod(pending.pointBPointIndex, points.length);
    const pointAPos = points[pointAIndex].point;
    const pointBPos = points[pointBIndex].point;

    const lenA = Vector2.dist(centerPos, pointAPos);
    const lenB = Vector2.dist(centerPos, pointBPos);

    if (offset >= lenA || offset >= lenB) {
      return;
    }

    let segIdxA = pending.segmentIndexA;
    let segIdxB = pending.segmentIndexB;

    // For the edge from center->point: segment starts at centerIndex, t = offset/len
    // For the edge from point->center: segment starts at pointIndex, t = 1 - offset/len
    const tA: number = segIdxA === centerPointIndex ? offset / lenA : 1 - offset / lenA;
    const tB: number = segIdxB === centerPointIndex ? offset / lenB : 1 - offset / lenB;

    const constraints = geometryStore.findConstraintsByGeometryId(geometryId);

    // Collect constraint info for center vertex
    const centerIsConstrained = this.isCenterConstrained(constraints, geometryId, centerPointIndex);

    // Step 1: Handle constraints on center vertex (create datum + colinear constraints)
    if (centerIsConstrained) {
      const datumPos = points[mod(centerPointIndex, points.length)].point;
      const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(datumPos), { direct: true });

      const datumEndpoint = ConstraintEndpoint.lockedToDatum(datum.id);

      // Relink constraint endpoints at center to datum
      for (const c of constraints) {
        const keys = Constraint.getPositionKeys(c);
        for (const k of keys) {
          const ep = (c as any)[k] as ConstraintEndpoint;
          if (
            ep &&
            typeof ep === 'object' &&
            ep.type === 'locked-polygon' &&
            ep.id === geometryId &&
            ep.pointIndex === centerPointIndex
          ) {
            geometryStore.updateConstraint(c.id, (existing: any) => ({
              ...existing,
              [k]: datumEndpoint,
            }));
          }
        }
      }

      // Add colinear constraints: datum lies on both edges
      // Far endpoints (the non-center vertices of each edge)
      // Edge A: the other endpoint of the segment (not center)
      const farAPointIndex =
        segIdxA === centerPointIndex ? mod(centerPointIndex + 1, points.length) : segIdxA;
      // Edge B: the other endpoint of the segment (not center)
      const farBPointIndex =
        segIdxB === centerPointIndex ? mod(centerPointIndex + 1, points.length) : segIdxB;

      geometryStore.addConstraint(
        ColinearConstraint.create(
          datumEndpoint,
          ConstraintEndpoint.lockedToPolygon(geometryId, farAPointIndex),
          ConstraintEndpoint.lockedToPolygon(geometryId, pointAIndex),
        ),
      );
      geometryStore.addConstraint(
        ColinearConstraint.create(
          datumEndpoint,
          ConstraintEndpoint.lockedToPolygon(geometryId, farBPointIndex),
          ConstraintEndpoint.lockedToPolygon(geometryId, pointBIndex),
        ),
      );
    }

    // Step 2: Split both edges (higher index first to avoid index shifts)
    let currentPolygon = polygon;
    let sortedSplits = [
      { segIdx: segIdxA, t: tA },
      { segIdx: segIdxB, t: tB },
    ].sort((a, b) => b.segIdx - a.segIdx);

    for (const { segIdx, t } of sortedSplits) {
      const currentConstraints = geometryStore.findConstraintsByGeometryId(geometryId);
      const result = PolygonComponent.addPointOnEdge(currentPolygon, currentConstraints, segIdx, {
        type: 't',
        t,
      });
      if (!result) {
        continue;
      }
      currentPolygon = result.geometry as typeof polygon;

      // Apply constraint re-indexing events
      for (const event of result.updatedConstraintHistoryEvents) {
        historyManager.apply(event);
      }
    }

    // Step 3: Remove center vertex and replace with cubic arc
    const currentPoints = PolygonComponent.get(currentPolygon).points;
    const currentCpi = this.findPointIndexByPos(currentPoints, centerPos);
    if (currentCpi < 0) {
      return;
    }

    // Pattern after splits: [..., farA, splitA, center, splitB, farB, ...]
    // splitA is at currentCpi-1, splitB is at currentCpi+1
    const splitAIdx = mod(currentCpi - 1, currentPoints.length);
    const splitBIdx = mod(currentCpi + 1, currentPoints.length);

    if (splitAIdx === currentCpi || splitBIdx === currentCpi) {
      return;
    }

    const splitAPos = currentPoints[splitAIdx].point;
    const splitBPos = currentPoints[splitBIdx].point;

    // Compute cubic bezier arc control points
    const arc = computeFilletArc(splitAPos, splitBPos, centerPos);

    // Build new points array: keep up to splitA, insert arc, skip center+splitB
    const newPoints = [
      ...currentPoints.slice(0, splitAIdx + 1),
      {
        type: 'arc-cubic' as const,
        point: splitBPos,
        controlPointA: arc.controlPointA,
        controlPointB: arc.controlPointB,
      } as CubicBezierSegment,
      ...currentPoints.slice(splitBIdx + 1),
    ];

    const finalGeometry = PolygonComponent.update(currentPolygon, { points: newPoints });
    geometryStore.updateById(geometryId, finalGeometry);
  }

  /** Checks if any constraint's endpoint references the center point of this polygon. */
  private isCenterConstrained(
    constraints: Array<Constraint>,
    geometryId: Id,
    centerPointIndex: number,
  ): boolean {
    for (const c of constraints) {
      const keys = Constraint.getPositionKeys(c);
      for (const key of keys) {
        const ep = (c as any)[key] as ConstraintEndpoint;
        if (
          ep &&
          typeof ep === 'object' &&
          ep.type === 'locked-polygon' &&
          ep.id === geometryId &&
          ep.pointIndex === centerPointIndex
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** Finds the index of a point in polygon points by position match. */
  private findPointIndexByPos(points: Array<{ point: SheetPosition }>, pos: SheetPosition): number {
    for (let i = 0; i < points.length; i++) {
      if (points[i].point.x === pos.x && points[i].point.y === pos.y) {
        return i;
      }
    }
    return -1;
  }
}

/** Modular arithmetic helper that returns a non-negative remainder. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
