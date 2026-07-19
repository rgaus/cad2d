import { Zap as ZapIcon } from 'lucide-react';
import React from 'react';
import {
  ColinearConstraint,
  Constraint,
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  DatumComponent,
  Entity,
  GeometryComponent,
  HorizontalConstraint,
  type Id,
  Polygon,
  VerticalConstraint,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { type ChamferFilterData } from '@/lib/entity/filters/chamfer';
import { type FilletFilterData } from '@/lib/entity/filters/fillet';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { PolygonSegment } from '@/lib/entity/polygon';
import { type RectangleEndpoint } from '@/lib/entity/rectangle';
import { CornerReplacement, type CornerSegmentFactory, Vector2, mod } from '@/lib/math';
import { CubicCurve, LineSegment, QuadraticCurve, SheetPosition } from '@/lib/viewport/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

type CornerState =
  | {
      mode: 'rectangle';
      geometryId: Id;
      centerEndpoint: RectangleEndpoint;
      pointAEndpoint: RectangleEndpoint;
      pointBEndpoint: RectangleEndpoint;
      centerPos: SheetPosition;
      pointAPos: SheetPosition;
      pointBPos: SheetPosition;
    }
  | {
      mode: 'polygon';
      geometryId: Id;
      centerIndex: number;
      pointAIndex: number;
      pointBIndex: number;
      centerPos: SheetPosition;
      pointAPos: SheetPosition;
      pointBPos: SheetPosition;
    };

type ResolveGeometryAndIndicesResults = {
  geometryId: Id;
  polygon: Entity<GeometryComponent<PolygonData>>;
  polygonData: PolygonData;
  centerIndex: number;
  pointAIndex: number;
  pointBIndex: number;
  centerDatumId: Datum['id'] | null;
  pointAIsAfterCenter: boolean;
  pointBIsAfterCenter: boolean;
};

type ValidateOffsetResults = {
  centerPos: SheetPosition;
  pointAPos: SheetPosition;
  pointBPos: SheetPosition;
  lenA: number;
  lenB: number;
  tA: number;
  tB: number;
  offset: number;
};

type SplitEdgesAtOffsetResults = {
  geometry: Entity<GeometryComponent<PolygonData>>;
  splitAPos: SheetPosition;
  splitBPos: SheetPosition;
  splitAIdx: number;
  splitBIdx: number;
  centerIdxFirst: number;
};

type BuildCornerSegmentResults = {
  geometry: Entity<GeometryComponent<PolygonData>>;
  addedSegmentIndex: number;
};

const RECTANGLE_ADJACENCY: Partial<
  Record<RectangleEndpoint, [RectangleEndpoint, RectangleEndpoint]>
> = {
  upperLeft: ['lowerLeft', 'upperRight'],
  upperRight: ['lowerRight', 'upperLeft'],
  lowerRight: ['lowerLeft', 'upperRight'],
  lowerLeft: ['lowerRight', 'upperLeft'],
};

export class ApplyFilterToGeometryAction extends BaseAction {
  type = 'apply-filter-to-geometry' as const;
  label = 'Apply Filter';
  stability = 'beta' as const;

  get icon(): React.ReactNode {
    return <ZapIcon size={20} />;
  }

  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.getSelectionManager().on('selectionChange', this.updateDisabled);
    this.disabled = !this.hasApplicableFilters();
  }

  private updateDisabled = () => {
    this.disabled = !this.hasApplicableFilters();
  };

  private hasApplicableFilters(): boolean {
    return [...this.getSelectionManager().getSelectedIds()].some((id) => {
      const geom = this.getGeometryStore().getByIdWithComponent(id, FilterComponent);
      if (!geom) {
        return false;
      }
      const filter = FilterComponent.get(geom);
      return filter.type === 'fillet' || filter.type === 'chamfer';
    });
  }

  async execute(): Promise<void> {
    await this.getHistoryManager().applyTransaction(
      this.type,
      () => {
        const selectedIds = [...this.getSelectionManager().getSelectedIds()];

        for (const id of selectedIds) {
          const filterGeom = this.getGeometryStore().getByIdWithComponent(id, FilterComponent);
          if (!filterGeom) {
            continue;
          }
          const filter = FilterComponent.get(filterGeom);

          switch (filter.type) {
            case 'fillet': {
              const offset = filter.offset.toSheetUnits(this.getSheet().defaultUnit).magnitude;
              const factory: CornerSegmentFactory<SheetPosition> = CornerReplacement.filletArc;

              const pending = this.buildCornerState(filter);
              if (!pending) {
                continue;
              }

              const step1 = this.resolveGeometryAndIndices(pending);
              const step2 = this.validateOffset(step1, offset);
              if (!step2) {
                continue;
              }
              const step3 = this.splitEdgesAtOffset(step1, step2);
              const step4 = this.buildCornerSegment(step1, step2, factory);
              this.addColinearConstraints(step1, step2, step3);
              this.addRectilinearConstraints(step1, step4);

              this.getGeometryStore().deleteById(id);
              this.getSelectionManager().deselect(id);
              break;
            }
            case 'chamfer': {
              const offset = filter.offset.toSheetUnits(this.getSheet().defaultUnit).magnitude;
              const factory: CornerSegmentFactory<SheetPosition> = CornerReplacement.chamferLine;

              const pending = this.buildCornerState(filter);
              if (!pending) {
                continue;
              }

              const step1 = this.resolveGeometryAndIndices(pending);
              const step2 = this.validateOffset(step1, offset);
              if (!step2) {
                continue;
              }
              const step3 = this.splitEdgesAtOffset(step1, step2);
              const step4 = this.buildCornerSegment(step1, step2, factory);
              this.addColinearConstraints(step1, step2, step3);
              this.addRectilinearConstraints(step1, step4);

              this.getGeometryStore().deleteById(id);
              this.getSelectionManager().deselect(id);
              break;
            }
            case 'mirror':
              break;
            default:
              filter satisfies never;
              break;
          }
        }
      },
      { collapseIfSingle: true },
    );
  }

  private buildCornerState(filter: FilletFilterData | ChamferFilterData): CornerState | null {
    const store = this.getGeometryStore();

    if (filter.geometryType === 'polygon') {
      const centerPos = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToPolygon(filter.geometryId, filter.pointCenterIndex),
      );
      const posA = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToPolygon(filter.geometryId, filter.pointAIndex),
      );
      const posB = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToPolygon(filter.geometryId, filter.pointBIndex),
      );
      if (!centerPos || !posA || !posB) {
        return null;
      }
      return {
        mode: 'polygon',
        geometryId: filter.geometryId,
        centerIndex: filter.pointCenterIndex,
        pointAIndex: filter.pointAIndex,
        pointBIndex: filter.pointBIndex,
        centerPos,
        pointAPos: posA,
        pointBPos: posB,
      };
    }

    if (filter.geometryType === 'rectangle') {
      const centerPos = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToRectangle(filter.geometryId, filter.pointCenterKeyPoint),
      );
      const posA = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToRectangle(filter.geometryId, filter.pointAKeyPoint),
      );
      const posB = store.resolveConstraintEndpoint(
        ConstraintEndpoint.lockedToRectangle(filter.geometryId, filter.pointBKeyPoint),
      );
      if (!centerPos || !posA || !posB) {
        return null;
      }
      return {
        mode: 'rectangle',
        geometryId: filter.geometryId,
        centerEndpoint: filter.pointCenterKeyPoint,
        pointAEndpoint: filter.pointAKeyPoint,
        pointBEndpoint: filter.pointBKeyPoint,
        centerPos,
        pointAPos: posA,
        pointBPos: posB,
      };
    }

    return null;
  }

  private resolveGeometryAndIndices(pending: CornerState): ResolveGeometryAndIndicesResults {
    const geometryStore = this.getGeometryStore();

    let geometryId = pending.geometryId;
    let geometry: Entity<GeometryComponent<PolygonData>>;
    let polygonData: PolygonData;
    let centerDatumId: Datum['id'] | null = null;
    let centerIndex: number = -1;
    let pointAIndex: number = -1;
    let pointBIndex: number = -1;
    let pointAIsAfterCenter: boolean;
    let pointBIsAfterCenter: boolean;
    switch (pending.mode) {
      case 'polygon': {
        const result = geometryStore.getByIdWithComponent(geometryId, GeometryComponent);
        if (!result || !GeometryComponent.isPolygon(result)) {
          throw new Error(
            'ApplyFilterToGeometryAction.resolveGeometryAndIndices: polygon not found',
          );
        }
        geometry = result;
        polygonData = GeometryComponent.get(geometry);

        centerIndex = pending.centerIndex;
        pointAIndex = pending.pointAIndex;
        pointBIndex = pending.pointBIndex;

        const n = polygonData.points.length;
        pointAIsAfterCenter = mod(pointAIndex - centerIndex, n) === 1;
        pointBIsAfterCenter = mod(pointBIndex - centerIndex, n) === 1;

        // Migrate constraints attached to centerIndex to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = Constraint.getEndpoint(c, key);
            if (
              ep &&
              ep.type === 'locked-polygon' &&
              ep.id === geometryId &&
              ep.pointIndex === pending.centerIndex
            ) {
              if (!centerDatumId) {
                const datum = geometryStore.addOrdered(
                  ID_PREFIXES.datum,
                  Datum.create(polygonData.points[pending.centerIndex].point),
                );
                centerDatumId = datum.id;
              }
              geometryStore.updateByIdWithComponent(c.id, ConstraintComponent, (g) =>
                ConstraintComponent.update(g, {
                  [key]: ConstraintEndpoint.lockedToDatum(centerDatumId!),
                }),
              );
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
          throw new Error(
            'ApplyFilterToGeometryAction.resolveGeometryAndIndices: rectangle endpoints not resolved',
          );
        }

        // Migrate constraints attached to center endpoint to a datum
        const constraints = geometryStore.findConstraintsByGeometryId(geometryId);
        for (const c of constraints) {
          const keys = Constraint.getPositionKeys(c);
          for (const key of keys) {
            const ep = Constraint.getEndpoint(c, key);
            if (
              ep &&
              ep.type === 'locked-rectangle' &&
              ep.id === geometryId &&
              ep.point === pending.centerEndpoint
            ) {
              if (!centerDatumId) {
                const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(resolvedCenter));
                centerDatumId = datum.id;
              }
              geometryStore.updateByIdWithComponent(c.id, ConstraintComponent, (g) =>
                ConstraintComponent.update(g, {
                  [key]: ConstraintEndpoint.lockedToDatum(centerDatumId!),
                }),
              );
            }
          }
        }

        // Convert rectangle to polygon
        geometry = geometryStore.convertRectangleToPolygon(geometryId, {
          insertConstraints: false,
        });
        geometryId = geometry.id;
        polygonData = GeometryComponent.get(geometry);

        // Find all three point indices by position in new polygon
        for (let i = 0; i < polygonData.points.length - 1; i += 1) {
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
          throw new Error(
            'ApplyFilterToGeometryAction.resolveGeometryAndIndices: could not find all point indices',
          );
        }

        if (polygonData.closed) {
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
          `ApplyFilterToGeometryAction.resolveGeometryAndIndices: Unknown pending.mode value ${(pending as any).mode}`,
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

  private splitEdgesAtOffset(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
  ): SplitEdgesAtOffsetResults {
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    let geometry = step1.polygon;
    const geometryId = step1.geometryId;
    const polygonData = step1.polygonData;

    // Split both edges (higher index first to avoid index shifts)
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
      const result = GeometryComponent.addPointOnEdge(geometry, currentConstraints, index, {
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

    const splitAPos = Vector2.lerp(step2.centerPos, step2.pointAPos, step2.offset / step2.lenA);
    const splitBPos = Vector2.lerp(step2.centerPos, step2.pointBPos, step2.offset / step2.lenB);

    const currentPoints = GeometryComponent.get(geometry).points;
    const splitAIdx = this.findPointIndexByPos(currentPoints, splitAPos);
    const splitBIdx = this.findPointIndexByPos(currentPoints, splitBPos);
    const centerIdxFirst = this.findPointIndexByPos(currentPoints, step2.centerPos);

    if (splitAIdx < 0 || splitBIdx < 0 || centerIdxFirst < 0) {
      throw new Error(
        'ApplyFilterToGeometryAction.splitEdgesAtOffset: could not find split or center indices',
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

  private buildCornerSegment(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    factory: CornerSegmentFactory<SheetPosition>,
  ): BuildCornerSegmentResults {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;

    const preSplitPoints = step1.polygonData.points;

    const viewportSegs: Array<
      LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>
    > = [];
    for (let i = 0; i < preSplitPoints.length - 1; i += 1) {
      viewportSegs.push(
        PolygonSegment.toLineSegmentOrCurve(preSplitPoints[i].point, preSplitPoints[i + 1]),
      );
    }

    const viewportLength = viewportSegs.length;
    const cornerSegIndex = (step1.centerIndex - 1 + viewportLength) % viewportLength;

    const result = CornerReplacement.applyToPolygon(
      viewportSegs,
      cornerSegIndex,
      step2.offset,
      factory,
    );

    const newPoints: Array<PolygonSegment> = [];
    const [firstPoint] = PolygonSegment.fromLineSegmentOrCurve(result.segments[0]);
    newPoints.push({ type: 'point', point: firstPoint });
    for (const seg of result.segments) {
      const [, polySeg] = PolygonSegment.fromLineSegmentOrCurve(seg);
      newPoints.push(polySeg);
    }

    const addedSegmentIndex = result.insertedSegmentIndex;

    geometryStore.updateById(geometryId, (old) => {
      if (!Entity.hasComponent(old, GeometryComponent)) {
        return old;
      }
      return GeometryComponent.update(old as Entity<GeometryComponent<PolygonData>>, {
        points: newPoints,
      });
    });

    return {
      geometry: geometryStore.getByIdWithComponent(geometryId, GeometryComponent) as Entity<
        GeometryComponent<PolygonData>
      >,
      addedSegmentIndex,
    };
  }

  private addColinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step2: ValidateOffsetResults,
    step3: SplitEdgesAtOffsetResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const centerDatumId = step1.centerDatumId;

    if (!centerDatumId) {
      return;
    }

    const finalPoly = geometryStore.getByIdWithComponent(geometryId, GeometryComponent) as Entity<
      GeometryComponent<PolygonData>
    >;
    if (!finalPoly) {
      return;
    }
    const finalPoints = GeometryComponent.get(
      finalPoly as Entity<GeometryComponent<PolygonData>>,
    ).points;

    const farAIdx = this.findPointIndexByPos(finalPoints, step2.pointAPos);
    const splitAFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitAPos);
    const farBIdx = this.findPointIndexByPos(finalPoints, step2.pointBPos);
    const splitBFinalIdx = this.findPointIndexByPos(finalPoints, step3.splitBPos);

    if (farAIdx >= 0 && splitAFinalIdx >= 0) {
      geometryStore.add(
        ID_PREFIXES.constraint,
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farAIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitAFinalIdx),
        ),
      );
    }
    if (farBIdx >= 0 && splitBFinalIdx >= 0) {
      geometryStore.add(
        ID_PREFIXES.constraint,
        ColinearConstraint.create(
          ConstraintEndpoint.lockedToDatum(centerDatumId),
          ConstraintEndpoint.lockedToPolygon(geometryId, farBIdx),
          ConstraintEndpoint.lockedToPolygon(geometryId, splitBFinalIdx),
        ),
      );
    }
  }

  private addRectilinearConstraints(
    step1: ResolveGeometryAndIndicesResults,
    step4: BuildCornerSegmentResults,
  ): void {
    const geometryStore = this.getGeometryStore();
    const geometryId = step1.geometryId;
    const addedSegmentIndex = step4.addedSegmentIndex;

    const polygonData = step1.polygonData;
    if (polygonData.points.length !== 5 || !polygonData.closed) {
      return;
    }

    let counter = 0;
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const pointA = ConstraintEndpoint.lockedToPolygon(geometryId, counter);
      let pointBIndex = counter + 1;
      if (pointBIndex > 4) {
        pointBIndex = 0;
      }
      const pointB = ConstraintEndpoint.lockedToPolygon(geometryId, pointBIndex);

      switch (side) {
        case 'top':
        case 'bottom':
          geometryStore.add(ID_PREFIXES.constraint, HorizontalConstraint.create(pointA, pointB));
          break;
        case 'left':
        case 'right':
          geometryStore.add(ID_PREFIXES.constraint, VerticalConstraint.create(pointA, pointB));
          break;
      }

      counter += 1;
      if (counter === addedSegmentIndex) {
        counter += 1;
      }
    }
  }

  private findPointIndexByPos(points: Array<{ point: SheetPosition }>, pos: SheetPosition): number {
    for (let i = 0; i < points.length; i++) {
      if (points[i].point.x === pos.x && points[i].point.y === pos.y) {
        return i;
      }
    }
    return -1;
  }
}
