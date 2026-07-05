import { SquareRoundCornerIcon } from 'lucide-react';
import {
  ColinearConstraint,
  Constraint,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  EllipseComponent,
  Geometry,
  type Id,
  PolygonComponent,
  RectangleComponent,
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
        let nextIndex = rawEndpoint.pointIndex + 1;
        while (nextIndex >= polygon.points.length) {
          nextIndex -= polygon.points.length;
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
    this.pendingCenterSnap = null;
    this.pendingPointASnap = null;
    this.pendingPointBSnap = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('pendingFilletChange', null);
  }

  /** Executes the fillet operation. Must be called inside a history transaction. */
  private processFillet(pending: PendingFilletState, offset: number): void {
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    let geometryId = pending.geometryId;
    let geometry, polygon;
    let centerDatumId: Datum['id'] | null = null;
    let centerIndex, pointAIndex, pointBIndex;
    let pointAIsAfterCenter, pointBIsAfterCenter;
    switch (pending.mode) {
      case 'polygon': {
        geometry = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
        if (!geometry) {
          return;
        }
        polygon = PolygonComponent.get(geometry);

        centerIndex = pending.centerIndex;
        pointAIndex = pending.pointAIndex;
        pointBIndex = pending.pointBIndex;

        pointAIsAfterCenter = pointAIndex > centerIndex;
        pointBIsAfterCenter = pointBIndex > centerIndex;

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
                  Datum.create(polygon.points[pending.centerIndex].point),
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
          return;
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
        geometry = geometryStore.convertRectangleToPolygon(geometryId);
        geometryId = geometry.id;
        polygon = PolygonComponent.get(geometry);

        // Find all three point indices by position in the new polygon
        for (let i = 0; i < polygon.points.length - 1 /* subtract final closed point */; i += 1) {
          const p = polygon.points[i].point;
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
          return;
        }

        console.log(
          'RECT',
          polygon.points.length - 1,
          'a=',
          pointAIndex,
          centerIndex,
          'b=',
          pointBIndex,
        );
        if (polygon.closed) {
          // pointAIndex or pointBIndex being at 0 or points.length-1 means sort of the same thing for
          // closed polygons (which a converted rectangle always will be).
          //
          // It is sort of domain specific which one you want... so if one point is at an extreme,
          // then compute the other point and use the negation of it as the original point value
          // (since they should always be on opposite sides of each other).
          const pointsLengthWithoutClosed = polygon.points.length - 1;
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

        while (centerIndex >= polygon.points.length - 1) {
          centerIndex -= polygon.points.length - 1;
        }
        while (pointAIndex >= polygon.points.length - 1) {
          pointAIndex -= polygon.points.length - 1;
        }
        while (pointBIndex >= polygon.points.length - 1) {
          pointBIndex -= polygon.points.length - 1;
        }

        break;
      }
      default:
        pending satisfies never;
        throw new Error(
          `FillerTool.processFillet: Unknown pending.mode value ${(pending as any).mode}`,
        );
    }

    // Validate distance against edge lengths
    const centerPos = polygon.points[centerIndex].point;
    const pointAPos = polygon.points[pointAIndex].point;
    const pointBPos = polygon.points[pointBIndex].point;

    const lenA = Vector2.dist(centerPos, pointAPos);
    const lenB = Vector2.dist(centerPos, pointBPos);

    if (offset >= lenA || offset >= lenB) {
      return;
    }
    // Compute split t values using the CENTER position from the polygon

    // For the edge from center->point: segment starts at centerIndex, t = offset/len
    // For the edge from point->center: segment starts at pointIndex, t = 1 - offset/len
    const tA = pointAIsAfterCenter ? offset / lenA : 1 - offset / lenA;
    const tB = pointBIsAfterCenter ? offset / lenB : 1 - offset / lenB;

    // Step 1: Split both edges (higher index first to avoid index shifts)
    let sortedSplits = [
      { index: pointAIsAfterCenter ? pointAIndex - 1 : pointAIndex, t: tA },
      { index: pointBIsAfterCenter ? pointBIndex - 1 : pointBIndex, t: tB },
    ]
      .map((sp) => {
        while (sp.index < 0) {
          sp.index += polygon.points.length - 1;
        }
        return sp;
      })
      .sort((a, b) => b.index - a.index);

    console.log(
      'SPLITS',
      JSON.stringify(sortedSplits),
      'centerIndex',
      centerIndex,
      'pointAIndex',
      pointAIndex,
      'pointBIndex',
      pointBIndex,
      'pointAIsAfterCenter',
      pointAIsAfterCenter,
      'pointBIsAfterCenter',
      pointBIsAfterCenter,
    );

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
    const splitAPos = Vector2.lerp(centerPos, pointAPos, offset / lenA);
    const splitBPos = Vector2.lerp(centerPos, pointBPos, offset / lenB);

    const currentPoints = PolygonComponent.get(geometry).points;
    const splitAIdx = this.findPointIndexByPos(currentPoints, splitAPos);
    const splitBIdx = this.findPointIndexByPos(currentPoints, splitBPos);
    const centerIdxFirst = this.findPointIndexByPos(currentPoints, centerPos);

    if (splitAIdx < 0 || splitBIdx < 0 || centerIdxFirst < 0) {
      return;
    }

    const minSplitIdx = Math.min(splitAIdx, splitBIdx);
    const maxSplitIdx = Math.max(splitAIdx, splitBIdx);
    const isWrapping = !(minSplitIdx < centerIdxFirst && centerIdxFirst < maxSplitIdx);

    console.log(
      'POST-SPLIT points length:',
      currentPoints.length,
      'splitAIdx:',
      splitAIdx,
      'splitBIdx:',
      splitBIdx,
      'centerIdxFirst:',
      centerIdxFirst,
      'isWrapping:',
      isWrapping,
    );
    console.log(
      'points:',
      currentPoints.map((p) => `${p.type}(${p.point.x},${p.point.y})`).join(', '),
    );
    console.log('splitAPos:', splitAPos.x, splitAPos.y, 'splitBPos:', splitBPos.x, splitBPos.y);

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

    const pts = currentPoints; // alias, since we compute tangents from the post-split array
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

    console.log(
      'ARC: r=',
      r,
      'kR=',
      kR.toFixed(3),
      'p0',
      p0.x.toFixed(1),
      p0.y.toFixed(1),
      'p3',
      p3.x.toFixed(1),
      p3.y.toFixed(1),
      'tStart',
      tStart.x.toFixed(3),
      tStart.y.toFixed(3),
      'tEnd',
      tEnd.x.toFixed(3),
      tEnd.y.toFixed(3),
      'cpA',
      cpA.x.toFixed(2),
      cpA.y.toFixed(2),
      'cpB',
      cpB.x.toFixed(2),
      cpB.y.toFixed(2),
    );

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
      } else if (maxSplitIdx === splitAIdx) {
        console.log('A MAX SPLIT');
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
      } else {
        console.log('B MAX SPLIT');
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
      }
      return PolygonComponent.update(old, { points: newPoints });
    });

    // Debug: log final polygon after arc insertion
    const dbgPoly = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
    if (dbgPoly) {
      const dbgPoints = PolygonComponent.get(dbgPoly).points;
      console.log(
        'FINAL:',
        dbgPoints
          .map((p) => `${p.type}(${p.point.x.toFixed(1)},${p.point.y.toFixed(1)})`)
          .join(', '),
      );
    } else {
      console.log('FINAL: no polygon found');
    }

    // Step 3: Add colinear constraints (datum on both edge lines).
    // Must happen AFTER arc insertion so indices resolve against the final polygon.
    if (centerDatumId) {
      const finalPoly = geometryStore.getByIdWithComponent(geometryId, PolygonComponent);
      if (!finalPoly) {
        return;
      }
      const finalPoints = PolygonComponent.get(finalPoly).points;

      const farAIdx = this.findPointIndexByPos(finalPoints, pointAPos);
      const splitAFinalIdx = this.findPointIndexByPos(finalPoints, splitAPos);
      const farBIdx = this.findPointIndexByPos(finalPoints, pointBPos);
      const splitBFinalIdx = this.findPointIndexByPos(finalPoints, splitBPos);

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
