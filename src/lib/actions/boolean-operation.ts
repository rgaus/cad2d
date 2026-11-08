import { type Geom, difference, intersection, union } from 'polyclip-ts';
import {
  Constraint,
  ConstraintComponent,
  ConstraintEndpoint,
  Datum,
  Entity,
  FillColorComponent,
  GeometryComponent,
  type Id,
  LinkDimensionsComponent,
  Polygon,
  PolygonSegment,
  RenderOrderComponent,
} from '@/lib/entity';
import { type GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { type Filter } from '@/lib/entity/filters';
import { RenderShape } from '@/lib/entity/render-shape';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { arcToLineSegments } from '@/lib/math';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

export type BooleanOperation = 'union' | 'intersection' | 'difference';

const OPERATIONS = { union, intersection, difference } as const;

/** Extracts the visible (rendered/oriented) outline of a geometry as sheet-space segments. */
export function renderedOutline(
  geometry: Entity<GeometryComponent>,
  sheetDefaultUnit: UnitType,
): Array<PolygonSegment<SheetPosition>> {
  const shapes = GeometryComponent.getRenderShapes(geometry, sheetDefaultUnit);
  const primary = shapes.find((shape) => shape.primary) ?? shapes[0];
  if (!primary) {
    return [];
  }
  return RenderShape.toPolygonSegments(primary);
}

function extractPointsFromSegments(
  segments: Array<PolygonSegment<SheetPosition>>,
): Array<SheetPosition> {
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
        const sampled = arcToLineSegments({
          start: prevPoint,
          end: seg.point,
          controlPoint: seg.controlPoint,
        });
        for (let i = 1; i < sampled.length; i += 1) {
          if (!positionsEqual(sampled[i], points[points.length - 1])) {
            points.push(sampled[i]);
          }
        }
      }
      prevPoint = seg.point;
    } else if (seg.type === 'arc-cubic') {
      if (prevPoint !== null) {
        const sampled = arcToLineSegments({
          start: prevPoint,
          end: seg.point,
          controlPointA: seg.controlPointA,
          controlPointB: seg.controlPointB,
        });
        for (let i = 1; i < sampled.length; i += 1) {
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

function isLockedToSource(endpoint: ConstraintEndpoint, sourceIds: Set<Id>): boolean {
  return endpoint.type !== 'point' && sourceIds.has(endpoint.id);
}

/**
 * Re-points constraints which reference one of the geometries being consumed by a boolean operation
 * at a datum located at the constraint's current rendered position. This keeps the constraints
 * valid after the source shapes are deleted.
 */
function migrateConstraintsToDatums(geometryStore: GeometryStore, sourceIds: Set<Id>): void {
  const datumsByPosition = new Map<string, Id>();
  const constraintIds = new Set<Id>();
  for (const sourceId of sourceIds) {
    for (const constraint of geometryStore.findConstraintsByGeometryId(sourceId)) {
      constraintIds.add(constraint.id);
    }
  }

  for (const constraintId of constraintIds) {
    const constraint = geometryStore.getByIdWithComponent(constraintId, ConstraintComponent);
    if (!constraint) {
      continue;
    }
    const updates: Record<string, ConstraintEndpoint> = {};
    for (const key of Constraint.getPositionKeys(constraint)) {
      const endpoint = Constraint.getEndpoint(constraint, key);
      if (!endpoint || !isLockedToSource(endpoint, sourceIds)) {
        continue;
      }
      const position = geometryStore.resolveConstraintEndpoint(endpoint);
      if (!position) {
        continue;
      }
      const positionKey = `${position.x}_${position.y}`;
      let datumId = datumsByPosition.get(positionKey);
      if (typeof datumId === 'undefined') {
        datumId = geometryStore.add(ID_PREFIXES.datum, Datum.create(position)).id;
        datumsByPosition.set(positionKey, datumId);
      }
      updates[key] = ConstraintEndpoint.lockedToDatum(datumId);
    }

    if (Object.keys(updates).length > 0) {
      geometryStore.updateByIdWithComponent(constraintId, ConstraintComponent, (geometry) =>
        ConstraintComponent.update(geometry, updates as never),
      );
    }
  }
}

/** Copies mirror/pattern filters attached to the consumed geometries onto the boolean result. */
function migrateFilters(
  geometryStore: GeometryStore,
  filters: Array<Filter>,
  resultSegments: Array<{
    id: Id;
    points: Array<PolygonSegment<SheetPosition>>;
  }>,
): void {
  if (resultSegments.length !== 1) {
    return;
  }
  const resultId = resultSegments[0].id;
  for (const filter of filters) {
    const data = FilterComponent.get(filter);
    if (data.type !== 'mirror' && data.type !== 'pattern') {
      continue;
    }
    const order = filter.components.filter.order;
    geometryStore.add(ID_PREFIXES.filter, {
      components: FilterComponent.create({ ...data, geometryId: resultId }, order),
    });
  }
}

export function executeBooleanOperation(args: {
  operation: BooleanOperation;
  geometryStore: GeometryStore;
  selectionManager: SelectionManager;
  historyManager: HistoryManager;
  sheetDefaultUnit: UnitType;
}): void {
  const { operation, geometryStore, selectionManager, historyManager, sheetDefaultUnit } = args;
  const selectedIds = selectionManager.getSelectedIds();
  if (selectedIds.length < 2) {
    return;
  }

  const inputs: Array<{
    id: Id;
    points: Array<SheetPosition>;
    fillColor: number | null;
    renderOrder: number | undefined;
    linkDimensions: boolean | undefined;
  }> = [];
  const filters: Array<Filter> = [];

  for (const id of selectedIds) {
    const geometry = geometryStore.getById(id);
    if (!geometry || !Entity.hasComponent(geometry, GeometryComponent)) {
      continue;
    }
    const segments = renderedOutline(geometry, sheetDefaultUnit);
    const points = extractPointsFromSegments(segments);
    if (points.length < 3) {
      continue;
    }
    inputs.push({
      id,
      points,
      fillColor: FillColorComponent.getOptional(geometry) ?? null,
      renderOrder: Entity.hasComponent(geometry, RenderOrderComponent)
        ? RenderOrderComponent.get(geometry)
        : undefined,
      linkDimensions: LinkDimensionsComponent.getOptional(geometry),
    });
    filters.push(...geometryStore.findFiltersByGeometryId(id));
  }

  if (inputs.length < 2) {
    return;
  }

  const clipPolys = inputs.map(
    (input) => [input.points.map((p) => [p.x, p.y] as [number, number])] as Geom,
  );
  const result = OPERATIONS[operation](...(clipPolys as [Geom, Geom]));
  if (result.length === 0 || result[0].length === 0) {
    return;
  }

  selectionManager.clearSelection();

  const firstFillColor = inputs[0].fillColor;
  const firstRenderOrder = inputs[0].renderOrder;
  const firstLinkDimensions = inputs[0].linkDimensions;
  const sourceIds = new Set(inputs.map((input) => input.id));

  const newPolygonIds = historyManager.applyTransaction(`boolean-${operation}`, () => {
    migrateConstraintsToDatums(geometryStore, sourceIds);

    for (const id of sourceIds) {
      geometryStore.deleteById(id);
    }

    const results: Array<{
      id: Id;
      points: Array<PolygonSegment<SheetPosition>>;
    }> = [];
    for (const polygon of result) {
      const newPoints: Array<PolygonSegment<SheetPosition>> = polygon[0].map(([x, y]) => ({
        type: 'point' as const,
        point: new SheetPosition(x, y),
      }));
      const newPolygon = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(newPoints, {
          closed: true,
          fillColor: firstFillColor,
          openAtIndex: 0,
        }),
        { renderOrder: firstRenderOrder },
      );
      if (typeof firstLinkDimensions === 'boolean') {
        geometryStore.updateByIdWithComponent(newPolygon.id, LinkDimensionsComponent, (g) =>
          LinkDimensionsComponent.update(g, firstLinkDimensions),
        );
      }
      results.push({ id: newPolygon.id, points: newPoints });
    }

    migrateFilters(geometryStore, filters, results);

    return results.map((entry) => entry.id);
  });

  selectionManager.selectAll(new Set(newPolygonIds));
}
