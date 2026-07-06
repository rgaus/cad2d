import { SquareRoundCornerIcon } from 'lucide-react';
import {
  ColinearConstraint,
  Constraint,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  EllipseComponent,
  Geometry,
  HorizontalConstraint,
  type Id,
  PolygonComponent,
  RectangleComponent,
  VerticalConstraint,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { type CubicBezierSegment, PolygonSegment } from '@/lib/geometry/polygon';
import { type RectangleEndpoint } from '@/lib/geometry/rectangle';
import { Vector2 } from '@/lib/math';
import { applyKeyPointSnapping, applySnapping } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';

export type PendingFilletState =
  | {
      mode: 'rectangle';
      geometryId: Id;
      centerEndpoint: RectangleEndpoint;
      pointAEndpoint: RectangleEndpoint;
      pointBEndpoint: RectangleEndpoint;
      centerPos: SheetPosition;
    }
  | {
      mode: 'polygon';
      geometryId: Id;
      centerIndex: number;
      pointAIndex: number;
      pointBIndex: number;
      centerPos: SheetPosition;
    };

export type FilletToolEvents = {
  previewSheetPositionChange: (
    data: { position: SheetPosition; isSnappedToKeyPoint: boolean } | null,
  ) => void;
  pendingFilletChange: (state: PendingFilletState | null) => void;
};

/**
 * Results from resolveGeometryAndIndices: resolves the polygon geometry and computes
 * center/pointA/pointB indices, handling both direct polygon selection and rectangle
 * shortcut modes. Also migrates any existing constraints attached to the center point
 * to a new datum.
 */
type PolygonData = PolygonComponent[keyof PolygonComponent];

type ResolveGeometryAndIndicesResults = {
  /** The ID of the polygon geometry being filleted. May differ from the input ID if a
   *  rectangle was converted to a polygon. */
  geometryId: Id;
  /** The resolved polygon geometry with PolygonComponent. */
  polygon: Geometry<PolygonComponent>;
  /** The raw polygon data (points array and closed flag) from PolygonComponent.get. */
  polygonData: PolygonData;
  /** Zero-based index of the center (corner) vertex in polygon.points. */
  centerIndex: number;
  /** Zero-based index of pointA (one adjacent vertex) in polygon.points. */
  pointAIndex: number;
  /** Zero-based index of pointB (other adjacent vertex) in polygon.points. */
  pointBIndex: number;
  /** ID of a newly created datum to which center-point constraints were migrated.
   *  Null if no constraints needed migration. */
  centerDatumId: Datum['id'] | null;
  /** True if pointA follows center in cyclic polygon order (mod n). Used to determine
   *  split direction and edge orientation. */
  pointAIsAfterCenter: boolean;
  /** True if pointB follows center in cyclic polygon order (mod n). Used to determine
   *  split direction and edge orientation. */
  pointBIsAfterCenter: boolean;
};

/**
 * Results from validateOffset: validates that the fillet offset is smaller than both
 * edge lengths and pre-computes geometric values needed for splitting and arc construction.
 */
type ValidateOffsetResults = {
  /** Sheet position of the center vertex. */
  centerPos: SheetPosition;
  /** Sheet position of pointA (far end of first edge). */
  pointAPos: SheetPosition;
  /** Sheet position of pointB (far end of second edge). */
  pointBPos: SheetPosition;
  /** Euclidean distance from center to pointA. */
  lenA: number;
  /** Euclidean distance from center to pointB. */
  lenB: number;
  /** The t parameter (0-1) along the center->pointA edge where the split occurs.
   *  Based on offset direction relative to pointAIsAfterCenter. */
  tA: number;
  /** The t parameter (0-1) along the center->pointB edge where the split occurs.
   *  Based on offset direction relative to pointBIsAfterCenter. */
  tB: number;
  /** The fillet offset distance in sheet units. */
  offset: number;
};

/**
 * Results from splitEdgesAtFilletPoints: inserts two new vertices on the polygon edges
 * at the fillet offset distance from the center. Constraint history events are replayed
 * to maintain constraint integrity.
 */
type SplitEdgesAtFilletPointsResults = {
  /** The updated polygon geometry after both edge splits. */
  geometry: Geometry<PolygonComponent>;
  /** Sheet position where the first edge was split (center->pointA side). */
  splitAPos: SheetPosition;
  /** Sheet position where the second edge was split (center->pointB side). */
  splitBPos: SheetPosition;
  /** Index in the post-split polygon.points array of splitA. */
  splitAIdx: number;
  /** Index in the post-split polygon.points array of splitB. */
  splitBIdx: number;
  /** Index of the center vertex in the post-split polygon. */
  centerIdxFirst: number;
};

/**
 * Results from buildFilletArc: computes the cubic bezier arc geometry and replaces
 * the center vertex region with the arc. Uses standard cubic bezier circle approximation.
 */
type BuildFilletArcResults = {
  /** The updated polygon geometry with the fillet arc inserted. */
  geometry: Geometry<PolygonComponent>;
  /** The index in polygon.points where the arc was inserted. Used by subsequent
   *  steps to skip over the arc when iterating perimeter points. */
  addedArcIndex: number;
};

/** For a rectangle, each corner's two adjacent corners are always the same two, so clicking
 * any corner identifies all three points without further clicks. Only the 4 perimeter corners
 * are included; extras like 'center' are omitted since fillets only make sense at corners. */
const RECTANGLE_ADJACENCY: Partial<
  Record<RectangleEndpoint, [RectangleEndpoint, RectangleEndpoint]>
> = {
  upperLeft: ['lowerLeft', 'upperRight'],
  upperRight: ['lowerRight', 'upperLeft'],
  lowerRight: ['lowerLeft', 'upperRight'],
  lowerLeft: ['lowerRight', 'upperLeft'],
};

type FilletToolState =
  | { type: 'idle' }
  | {
      type: 'awaiting-distance';
      pending: PendingFilletState;
    };

/**
 * A tool for creating fillets (rounded corners) on polygon shapes.
 *
 * UX flow for polygons:
 *  1. Click a corner vertex (key point on a polygon)
 *  2. Click an adjacent vertex on one edge
 *  3. Click an adjacent vertex on the other edge
 *  4. Enter the fillet offset distance in a popup input
 *  5. The corner is replaced with a circular cubic bezier arc
 *
 * Rectangle shortcut: clicking any rectangle corner jumps directly from step 1
 * to step 4, since the two adjacent corners are always unambiguous.
 */
export class FilletCreationTool extends BaseTool<FilletToolEvents, 'fillet'> {
  type = 'fillet' as const;
  label = 'Fillet';
  stability = 'beta' as const;

  get icon(): React.ReactNode {
    return <SquareRoundCornerIcon size={24} color="white" />;
  }

  focusKeyCombo = 'f' as const;

  private state: FilletToolState = { type: 'idle' };
  private previewSheetPos: SheetPosition | null = null;

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
    const { endpoint: rawEndpoint } = applyKeyPointSnapping(
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

    switch (rawEndpoint.type) {
      // Rectangle shortcut: skip the 3-click flow and go directly to
      // distance entry since the adjacent corners are deterministic.
      case 'locked-rectangle': {
        const pos = geometryStore.resolveConstraintEndpoint(rawEndpoint);
        const adjacencies = RECTANGLE_ADJACENCY[rawEndpoint.point as RectangleEndpoint];
        if (!pos || typeof adjacencies === 'undefined') {
          return;
        }
        const [labelA, labelB] = adjacencies;
        const pending: PendingFilletState = {
          mode: 'rectangle',
          geometryId: rawEndpoint.id,
          centerEndpoint: rawEndpoint.point,
          pointAEndpoint: labelA,
          pointBEndpoint: labelB,
          centerPos: pos,
        };
        this.state = { type: 'awaiting-distance', pending };
        this.emit('pendingFilletChange', pending);
        return;
      }
      case 'locked-polygon': {
        const geometry = geometryStore.getByIdWithComponent(rawEndpoint.id, PolygonComponent);
        if (!geometry) {
          return;
        }
        const polygon = PolygonComponent.get(geometry);

        let previousIndex = rawEndpoint.pointIndex - 1;
        while (previousIndex < 0) {
          previousIndex += polygon.points.length;
        }
        // Skip indices that are at the same position as the center (closing duplicate).
        const centerPoint = polygon.points[rawEndpoint.pointIndex].point;
        while (
          polygon.points[previousIndex].point.x === centerPoint.x &&
          polygon.points[previousIndex].point.y === centerPoint.y
        ) {
          previousIndex -= 1;
          while (previousIndex < 0) {
            previousIndex += polygon.points.length;
          }
        }
        let nextIndex = rawEndpoint.pointIndex + 1;
        while (nextIndex >= polygon.points.length) {
          nextIndex -= polygon.points.length;
        }
        while (
          polygon.points[nextIndex].point.x === centerPoint.x &&
          polygon.points[nextIndex].point.y === centerPoint.y
        ) {
          nextIndex += 1;
          while (nextIndex >= polygon.points.length) {
            nextIndex -= polygon.points.length;
          }
        }

        const pos = geometryStore.resolveConstraintEndpoint(rawEndpoint);
        if (!pos) {
          return;
        }

        const pending: PendingFilletState = {
          mode: 'polygon',
          geometryId: rawEndpoint.id,
          centerIndex: rawEndpoint.pointIndex,
          pointAIndex: previousIndex,
          pointBIndex: nextIndex,
          centerPos: pos,
        };
        this.state = { type: 'awaiting-distance', pending };
        this.emit('pendingFilletChange', pending);
        return;
      }
      default:
        // Other geometries don't really make sense to apply a fillet to
        // So ignore them.
        break;
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
    const { endpoint: keyPointEndpoint } = applyKeyPointSnapping(
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
  setFilletDistance(offsetLength: Length): void {
    if (this.state.type !== 'awaiting-distance') {
      return;
    }
    const pending = this.state.pending;
    const historyManager = this.getHistoryManager();
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const offset = offsetLength.toSheetUnits(sheet.defaultUnit).magnitude;

    historyManager.applyTransaction('fillet', () => {
      this.processFillet(pending, offset);
    });

    this.abort();
  }

  private abort(): void {
    this.state = { type: 'idle' };
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('pendingFilletChange', null);
  }

  /** Executes the fillet operation. Must be called inside a history transaction. */
  private processFillet(pending: PendingFilletState, offset: number): void {
    const step1 = this.resolveGeometryAndIndices(pending);
    const step2 = this.validateOffset(step1, offset);
    if (!step2) {
      return;
    }
    const step3 = this.splitEdgesAtFilletPoints(step1, step2);
    const step4 = this.buildFilletArc(step1, step2, step3);
    this.addColinearConstraints(step1, step2, step3);
    this.addRectilinearConstraints(step1, step4);
  }

  /**
   * Resolves the polygon geometry and computes the center/pointA/pointB indices, handling
   * both direct polygon selection and rectangle shortcut modes. Also migrates any existing
   * constraints attached to the center point to a new datum.
   */
  private resolveGeometryAndIndices(pending: PendingFilletState): ResolveGeometryAndIndicesResults {
    const geometryStore = this.getGeometryStore();

    let geometryId = pending.geometryId;
    let geometry: Geometry<PolygonComponent>;
    let polygonData: PolygonData;
    let centerDatumId: Datum['id'] | null = null;
    let centerIndex: number = -1;
    let pointAIndex: number = -1;
    let pointBIndex: number = -1;
    let pointAIsAfterCenter: boolean;
    let pointBIsAfterCenter: boolean;
    switch (pending.mode) {
      case 'polygon': {
        geometry = geometryStore.getByIdWithComponent(
          geometryId,
          PolygonComponent,
        ) as Geometry<PolygonComponent>;
        if (!geometry) {
          throw new Error('FilletTool.resolveGeometryAndIndices: polygon not found');
        }
        polygonData = PolygonComponent.get(geometry);

        centerIndex = pending.centerIndex;
        pointAIndex = pending.pointAIndex;
        pointBIndex = pending.pointBIndex;

        // Use modular arithmetic to correctly handle wrapping in closed polygons.
        // A point is "after" the center if its cyclic distance is +1 (mod n).
        const n = polygonData.points.length;
        pointAIsAfterCenter = mod(pointAIndex - centerIndex, n) === 1;
        pointBIsAfterCenter = mod(pointBIndex - centerIndex, n) === 1;

        // Get any constraints attached to the centerIndex, and move these to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = (c as any)[key] as ConstraintEndpoint;
            if (
              ep.type === 'locked-polygon' &&
              ep.id === geometryId &&
              ep.pointIndex === pending.centerIndex
            ) {
              // Found a constraint attached to the "center" point!
              // So make a datum if needed and migrate it over to be locked to the datum.
              if (!centerDatumId) {
                const datum = geometryStore.add(
                  ID_PREFIXES.datum,
                  Datum.create(polygonData.points[pending.centerIndex].point),
                );
                centerDatumId = datum.id;
              }
              geometryStore.updateConstraint(c.id, {
                [key]: ConstraintEndpoint.lockedToDatum(centerDatumId),
              });
            }
          }
        }
        break;
      }
      case 'rectangle': {
        const resolvedCenter = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.centerEndpoint),
        );
        const resolvedA = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.pointAEndpoint),
        );
        const resolvedB = geometryStore.resolveConstraintEndpoint(
          ConstraintEndpoint.lockedToRectangle(geometryId, pending.pointBEndpoint),
        );
        if (!resolvedCenter || !resolvedA || !resolvedB) {
          throw new Error('FilletTool.resolveGeometryAndIndices: rectangle endpoints not resolved');
        }

        // Get any constraints attached to the "center" point, and move these to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = (c as any)[key] as ConstraintEndpoint;
            if (
              ep.type === 'locked-rectangle' &&
              ep.id === geometryId &&
              ep.point === pending.centerEndpoint
            ) {
              // Found a constraint attached to the "center" point!
              // So make a datum if needed and migrate it over to be locked to the datum.
              if (!centerDatumId) {
                const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(resolvedCenter));
                centerDatumId = datum.id;
              }
              geometryStore.updateConstraint(c.id, {
                [key]: ConstraintEndpoint.lockedToDatum(centerDatumId),
              });
            }
          }
        }

        // Convert from rectangle => polygon
        geometry = geometryStore.convertRectangleToPolygon(geometryId, {
          insertConstraints: false,
        });
        geometryId = geometry.id;
        polygonData = PolygonComponent.get(geometry);

        // Find all three point indices by position in the new polygon
        for (
          let i = 0;
          i < polygonData.points.length - 1 /* subtract final closed point */;
          i += 1
        ) {
          const p = polygonData.points[i].point;
          if (p.x === resolvedCenter.x && p.y === resolvedCenter.y) {
            centerIndex = i;
          }
          if (p.x === resolvedA.x && p.y === resolvedA.y) {
            pointAIndex = i;
          }
          if (p.x === resolvedB.x && p.y === resolvedB.y) {
            pointBIndex = i;
          }
        }

        if (
          typeof centerIndex !== 'number' ||
          typeof pointAIndex !== 'number' ||
          typeof pointBIndex !== 'number'
        ) {
          throw new Error('FilletTool.resolveGeometryAndIndices: could not find all point indices');
        }

        if (polygonData.closed) {
          // pointAIndex or pointBIndex being at 0 or points.length-1 means sort of the same thing for
          // closed polygons (which a converted rectangle always will be).
          //
          // It is sort of domain specific which one you want... so if one point is at an extreme,
          // then compute the other point and use the negation of it as the original point value
          // (since they should always be on opposite sides of each other).
          const pointsLengthWithoutClosed = polygonData.points.length - 1;
          if (pointAIndex === 0 || pointAIndex === pointsLengthWithoutClosed - 1) {
            pointBIsAfterCenter = pointBIndex > centerIndex;
            pointAIsAfterCenter = !pointBIsAfterCenter;
          } else if (pointBIndex === 0 || pointBIndex === pointsLengthWithoutClosed - 1) {
            pointAIsAfterCenter = pointAIndex > centerIndex;
            pointBIsAfterCenter = !pointAIsAfterCenter;
          } else {
            pointAIsAfterCenter = pointAIndex > centerIndex;
            pointBIsAfterCenter = pointBIndex > centerIndex;
          }
        } else {
          // Open polygons need no special logic.
          pointAIsAfterCenter = pointAIndex > centerIndex;
          pointBIsAfterCenter = pointBIndex > centerIndex;
        }

        while (centerIndex >= polygonData.points.length - 1) {
          centerIndex -= polygonData.points.length - 1;
        }
        while (pointAIndex >= polygonData.points.length - 1) {
          pointAIndex -= polygonData.points.length - 1;
        }
        while (pointBIndex >= polygonData.points.length - 1) {
          pointBIndex -= polygonData.points.length - 1;
        }

        break;
      }
      default:
        pending satisfies never;
        throw new Error(
          `FillerTool.resolveGeometryAndIndices: Unknown pending.mode value ${(pending as any).mode}`,
        );
    }

    return {
      geometryId,
      polygon: geometry,
      polygonData,
      centerIndex,
      pointAIndex,
      pointBIndex,
      centerDatumId,
      pointAIsAfterCenter,
      pointBIsAfterCenter,
    };
  }

  /**
   * Validates that the fillet offset is smaller than both edge lengths from center to pointA
   * and center to pointB. Returns positions and pre-computed t values used by subsequent
   * steps to locate split points and determine arc geometry. Returns null if the offset
   * is too large (silent early exit).
   */
  private validateOffset(
    step1: ResolveGeometryAndIndicesResults,
    offset: number,
  ): ValidateOffsetResults | null {
    const polygonData = step1.polygonData;
    const centerIndex = step1.centerIndex;
    const pointAIndex = step1.pointAIndex;
    const pointBIndex = step1.pointBIndex;

    const centerPos = polygonData.points[centerIndex].point;
    const pointAPos = polygonData.points[pointAIndex].point;
    const pointBPos = polygonData.points[pointBIndex].point;

    const lenA = Vector2.dist(centerPos, pointAPos);
    const lenB = Vector2.dist(centerPos, pointBPos);

    if (offset >= lenA || offset >= lenB) {
      return null;
    }
    // Compute split t values using the CENTER position from the polygon

    // For the edge from center->point: segment starts at centerIndex, t = offset/len
    // For the edge from point->center: segment starts at pointIndex, t = 1 - offset/len
    const tA = step1.pointAIsAfterCenter ? offset / lenA : 1 - offset / lenA;
    const tB = step1.pointBIsAfterCenter ? offset / lenB : 1 - offset / lenB;

    return {
      centerPos,
      pointAPos,
      pointBPos,
      lenA,
      lenB,
      tA,
      tB,
      offset,
    };
  }

  /**
   * Inserts two new vertices on the polygon edges at the fillet offset distance from the
   * center. Uses PolygonComponent.addPointOnEdge to insert midpoint vertices at the
   * calculated t values. Split indices are computed higher-first to avoid index-shift
   * issues during insertion. Constraint history events are replayed to maintain constraint
   * integrity.
   */
  private splitEdgesAtFilletPoints(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
  ): SplitEdgesAtFilletPointsResults {
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    let geometry = step1.polygon;
    const geometryId = step1.geometryId;
    const polygonData = step1.polygonData;

    // Step 1: Split both edges (higher index first to avoid index shifts)
    let sortedSplits = [
      { index: step1.pointAIsAfterCenter ? step1.pointAIndex - 1 : step1.pointAIndex, t: step2.tA },
      { index: step1.pointBIsAfterCenter ? step1.pointBIndex - 1 : step1.pointBIndex, t: step2.tB },
    ]
      .map((sp) => {
        while (sp.index < 0) {
          sp.index += polygonData.points.length - 1;
        }
        return sp;
      })
      .sort((a, b) => b.index - a.index);

    for (const { index, t } of sortedSplits) {
      const currentConstraints = geometryStore.findConstraintsByGeometryId(geometryId);
      const result = PolygonComponent.addPointOnEdge(geometry, currentConstraints, index, {
        type: 't',
        t,
      });
      if (!result) {
        continue;
      }
      geometry = result.geometry as typeof geometry;

      for (const event of result.updatedConstraintHistoryEvents) {
        historyManager.apply(event);
      }
    }

    geometryStore.updateById(geometryId, geometry);

    // Step 2: Find split positions and rebuild the polygon with the fillet arc.
    // Position matching replaces fragile index arithmetic — the array-seam
    // wrapping case (center at index 0 of a closed polygon) is inherently
    // handled by comparing positions rather than computing shifted indices.
    const splitAPos = Vector2.lerp(step2.centerPos, step2.pointAPos, step2.offset / step2.lenA);
    const splitBPos = Vector2.lerp(step2.centerPos, step2.pointBPos, step2.offset / step2.lenB);

    const currentPoints = PolygonComponent.get(geometry).points;
    const splitAIdx = this.findPointIndexByPos(currentPoints, splitAPos);
    const splitBIdx = this.findPointIndexByPos(currentPoints, splitBPos);
    const centerIdxFirst = this.findPointIndexByPos(currentPoints, step2.centerPos);

    if (splitAIdx < 0 || splitBIdx < 0 || centerIdxFirst < 0) {
      throw new Error(
        'FilletTool.splitEdgesAtFilletPoints: could not find split or center indices',
      );
    }

    return {
      geometry,
      splitAPos,
      splitBPos,
      splitAIdx,
      splitBIdx,
      centerIdxFirst,
    };
  }

  /**
   * Computes the cubic bezier arc geometry and replaces the center vertex region with
   * the arc. Determines whether the arc wraps around the polygon seam or replaces the
   * center in-place, then computes tangent directions and control points using the
   * standard cubic bezier circle approximation. The polygon is rebuilt with the arc
   * inserted at the correct position.
   */
  private buildFilletArc(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    step3: SplitEdgesAtFilletPointsResults,
  ): BuildFilletArcResults {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    let geometry = step3.geometry;
    const centerPos = step2.centerPos;
    const pointAPos = step2.pointAPos;
    const pointBPos = step2.pointBPos;
    const splitAPos = step3.splitAPos;
    const splitBPos = step3.splitBPos;
    const splitAIdx = step3.splitAIdx;
    const splitBIdx = step3.splitBIdx;
    const centerIdxFirst = step3.centerIdxFirst;
    const offset = step2.offset;

    const minSplitIdx = Math.min(splitAIdx, splitBIdx);
    const maxSplitIdx = Math.max(splitAIdx, splitBIdx);
    const isWrapping = !(minSplitIdx < centerIdxFirst && centerIdxFirst < maxSplitIdx);

    // Arc direction:
    //   Non-wrapping: arc goes splitA -> splitB (replaces the center).
    //   Wrapping:     arc goes maxSplit -> minSplit (closes the loop).

    // Compute tangents from polygon edge directions at the split points.
    // The tangent at P0 matches the direction from the previous vertex toward P0;
    // the tangent at P3 matches the direction from P3 toward the next vertex.
    // Control points: P1 = P0 + t_start * k*R,  P2 = P3 - t_end * k*R.
    const r = offset;
    const cosTheta = Math.max(
      -1,
      Math.min(
        1,
        Vector2.dot(
          Vector2.norm(Vector2.sub(pointAPos, centerPos)),
          Vector2.norm(Vector2.sub(pointBPos, centerPos)),
        ),
      ),
    );
    const theta = Math.acos(cosTheta);
    const kVal = (4 / 3) * Math.tan(theta / 4);
    const kR = kVal * r;

    const pts = PolygonComponent.get(geometry).points; // alias, since we compute tangents from the post-split array
    let p0: SheetPosition;
    let p3: SheetPosition;
    let tStart: SheetPosition;
    let tEnd: SheetPosition;

    if (isWrapping) {
      if (maxSplitIdx === splitAIdx) {
        p0 = splitAPos;
        p3 = splitBPos;
      } else {
        p0 = splitBPos;
        p3 = splitAPos;
      }
      tStart = Vector2.norm(
        Vector2.sub(p0, pts[(maxSplitIdx - 1 + pts.length) % pts.length].point),
      );
    } else if (maxSplitIdx === splitAIdx) {
      p0 = splitBPos;
      p3 = splitAPos;
      tStart = Vector2.norm(Vector2.sub(p0, pts[splitBIdx - 1].point));
    } else {
      p0 = splitAPos;
      p3 = splitBPos;
      tStart = Vector2.norm(Vector2.sub(p0, pts[splitAIdx - 1].point));
    }

    if (isWrapping) {
      tEnd = Vector2.norm(Vector2.sub(pts[(minSplitIdx + 1) % pts.length].point, p3));
    } else if (maxSplitIdx === splitAIdx) {
      tEnd = Vector2.norm(Vector2.sub(pts[splitAIdx + 1].point, p3));
    } else {
      tEnd = Vector2.norm(Vector2.sub(pts[splitBIdx + 1].point, p3));
    }

    const cpA = Vector2.add(p0, Vector2.scale(tStart, kR));
    const cpB = Vector2.sub(p3, Vector2.scale(tEnd, kR));

    let addedArcIndex = -1;
    geometryStore.updateById(geometryId, (old) => {
      if (!Geometry.hasComponent(old, PolygonComponent)) {
        return old;
      }
      const oldPoints = PolygonComponent.get(old).points;
      let newPoints: Array<PolygonSegment>;
      if (isWrapping) {
        newPoints = [
          ...oldPoints.slice(minSplitIdx, maxSplitIdx + 1),
          {
            type: 'arc-cubic' as const,
            point: oldPoints[minSplitIdx].point,
            controlPointA: cpA,
            controlPointB: cpB,
          } as CubicBezierSegment,
        ];
        addedArcIndex = newPoints.length - 1;
      } else if (maxSplitIdx === splitAIdx) {
        newPoints = [
          ...oldPoints.slice(0, splitAIdx - 1),
          {
            type: 'arc-cubic' as const,
            point: oldPoints[splitAIdx].point,
            controlPointA: cpA,
            controlPointB: cpB,
          } as CubicBezierSegment,
          ...oldPoints.slice(splitBIdx + 3),
        ];
        addedArcIndex = splitAIdx - 2;
      } else {
        newPoints = [
          ...oldPoints.slice(0, splitBIdx - 1),
          {
            type: 'arc-cubic' as const,
            point: oldPoints[splitBIdx].point,
            controlPointA: cpA,
            controlPointB: cpB,
          } as CubicBezierSegment,
          ...oldPoints.slice(splitAIdx + 3),
        ];
        addedArcIndex = splitBIdx - 2;
      }
      return PolygonComponent.update(old, { points: newPoints });
    });

    return {
      geometry: geometryStore.getByIdWithComponent(
        geometryId,
        PolygonComponent,
      ) as Geometry<PolygonComponent>,
      addedArcIndex,
    };
  }

  /**
   * Adds colinear constraints linking the center datum to the far vertices (pointA, pointB)
   * and their corresponding split vertices. These constraints keep the fillet arc centered
   * on the original corner. Must happen AFTER arc insertion so indices resolve against
   * the final polygon.
   */
  private addColinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    step3: SplitEdgesAtFilletPointsResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const centerDatumId = step1.centerDatumId;

    if (!centerDatumId) {
      return;
    }

    const finalPoly = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
    if (!finalPoly) {
      return;
    }
    const finalPoints = PolygonComponent.get(finalPoly).points;

    const farAIdx = this.findPointIndexByPos(finalPoints, step2.pointAPos);
    const splitAFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitAPos);
    const farBIdx = this.findPointIndexByPos(finalPoints, step2.pointBPos);
    const splitBFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitBPos);

    if (farAIdx >= 0 && splitAFinalIdx >= 0) {
      geometryStore.addConstraint(
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farAIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitAFinalIdx),
        ),
      );
    }
    if (farBIdx >= 0 && splitBFinalIdx >= 0) {
      geometryStore.addConstraint(
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farBIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitBFinalIdx),
        ),
      );
    }
  }

  /**
   * For polygons created by converting a rectangle, adds horizontal constraints on
   * top/bottom edges and vertical constraints on left/right edges. Iterates perimeter
   * points in order, skipping over the inserted arc index. The rectangle is always
   * converted to a 5-point polygon (4 sides + 1 arc), so this iterates the 4 sides
   * in ['top', 'right', 'bottom', 'left'] order.
   */
  private addRectilinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step4: BuildFilletArcResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const addedArcIndex = step4.addedArcIndex;

    // Only applies when a rectangle was converted to a polygon.
    // This is implicitly true when resolveGeometryAndIndices returned the polygon with
    // the center point at a rectangle corner, which we detect by checking if the polygon
    // has 5 points (4 sides + 1 arc). We pass this signal via the polygon having
    // centerDatumId === null but the polygon having 5 points.
    // Actually, we detect this by checking if pointAIsAfterCenter and pointBIsAfterCenter
    // were computed from the rectangle adjacency. Since we don't have a separate flag,
    // we check if the polygon has 5 points and was closed.
    const polygonData = step1.polygonData;
    if (polygonData.points.length !== 5 || !polygonData.closed) {
      return;
    }

    let counter = 0;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const pointA = ConstraintEndpoint.lockedToPolygon(geometryId, counter);
      let pointBIndex = counter + 1;
      if (pointBIndex > 4 /* 4 sides */) {
        pointBIndex = 0;
      }
      const pointB = ConstraintEndpoint.lockedToPolygon(geometryId, pointBIndex);

      switch (side) {
        case 'top':
        case 'bottom':
          geometryStore.addConstraint(HorizontalConstraint.create(pointA, pointB));
          break;
        case 'left':
        case 'right':
          geometryStore.addConstraint(VerticalConstraint.create(pointA, pointB));
          break;
      }

      counter += 1;
      if (counter === addedArcIndex) {
        // Skip over the arc
        counter += 1;
      }
    }
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
