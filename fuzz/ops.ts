import {
  ConstraintEndpoint,
  type ConstraintEndpoint as ConstraintEndpointType,
  DatumComponent,
  Entity,
  GeometryComponent,
  HorizontalConstraint,
  LinearConstraint,
  PolygonSegment,
  VerticalConstraint,
} from '@/lib/entity';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { type EllipseData } from '@/lib/entity/geometry/ellipse';
import { type PolygonData } from '@/lib/entity/geometry/polygon';
import { type RectangleData } from '@/lib/entity/geometry/rectangle';
import { ellipseToPolygon, rectangleToPolygon } from '@/lib/math';
import { computeLineSegmentIntersection } from '@/lib/math/intersection';
import { Length } from '@/lib/units/length';
import { LineSegment, ScreenPosition, SheetPosition } from '@/lib/viewport/types';
import type { FuzzApp } from './app';
import { PRNG } from './prng';
import type {
  EndpointRef,
  OpRecord,
  OpResult,
  Point,
  RectangleKeypointKey,
  UnitName,
} from './types';

const EPSILON = 1e-9;

function toSheetPoint(p: Point): SheetPosition {
  return new SheetPosition(p.x, p.y);
}

function minDistanceBetweenPoints(points: Array<SheetPosition>): number {
  let min = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      min = Math.min(min, Math.sqrt(dx * dx + dy * dy));
    }
  }
  return min;
}

/** Generates n random distinct points spread out within the sheet bounds. */
export function randomSheetPoints(app: FuzzApp, n: number): Array<SheetPosition> {
  const maxW = Math.max(app.sheet.width.toSheetUnits(app.sheet.defaultUnit).magnitude - 2, 2);
  const maxH = Math.max(app.sheet.height.toSheetUnits(app.sheet.defaultUnit).magnitude - 2, 2);
  const attempts = 0;
  void attempts;
  for (let tries = 0; tries < 20; tries += 1) {
    const points: Array<SheetPosition> = [];
    for (let i = 0; i < n; i += 1) {
      points.push(new SheetPosition(app.rng.range(0.5, maxW), app.rng.range(0.5, maxH)));
    }
    if (minDistanceBetweenPoints(points) > EPSILON) {
      return points;
    }
  }
  return [];
}

// ============================================================
// Op execution
// ============================================================

function selectIds(app: FuzzApp, ids: Array<string>): void {
  // Only select ids that still exist - matching what the real renderer can do
  // (a user can only select visible geometry). Without this, the fuzzer could
  // manufacture an "invalid selection" that real users cannot produce.
  const valid = ids.filter((id) => app.geometryStore.hasId(id));
  const selection = app.selectionManager;
  selection.clearSelection();
  selection.selectAll(new Set(valid));
}

async function executeSelectionAction(app: FuzzApp, actionType: string, ids: Array<string>) {
  selectIds(app, ids);
  await app.actionsManager.execute(actionType as never);
}

function resolveEndpoint(
  app: FuzzApp,
  ref: EndpointRef,
): {
  sheet: SheetPosition;
  endpoint: ConstraintEndpointType;
} | null {
  const store = app.geometryStore;
  switch (ref.type) {
    case 'free':
      return { sheet: toSheetPoint(ref), endpoint: ConstraintEndpoint.point(toSheetPoint(ref)) };
    case 'polygon-vertex': {
      const geom = store.getByIdWithComponent(ref.id, GeometryComponent);
      if (!geom || !GeometryComponent.isPolygon(geom)) {
        return null;
      }
      const data = GeometryComponent.get(geom);
      const seg = data.points[ref.index];
      if (!seg) {
        return null;
      }
      const endpoint = ConstraintEndpoint.lockedToPolygon(ref.id, ref.index);
      return { sheet: seg.point, endpoint };
    }
    case 'rectangle-keypoint': {
      const geom = store.getByIdWithComponent(ref.id, GeometryComponent);
      if (!geom || !GeometryComponent.isRectangle(geom)) {
        return null;
      }
      const kp = GeometryComponent.keyPoints(geom);
      const sheet = resolveKeyPointPosition(geom, ref.key);
      if (!sheet) {
        return null;
      }
      const endpoint = ConstraintEndpoint.lockedToRectangle(
        ref.id,
        ref.key as Parameters<typeof ConstraintEndpoint.lockedToRectangle>[1],
      );
      return { sheet, endpoint };
    }
    case 'ellipse-keypoint': {
      const geom = store.getByIdWithComponent(ref.id, GeometryComponent);
      if (!geom || !GeometryComponent.isEllipse(geom)) {
        return null;
      }
      const kp = GeometryComponent.keyPoints(geom);
      const perimeterIdx = kp.perimeterLabels.indexOf(ref.key as never);
      const sheet =
        perimeterIdx !== -1
          ? kp.perimeter[perimeterIdx]
          : (kp.extras[ref.key as keyof typeof kp.extras] ?? null);
      if (!sheet) {
        return null;
      }
      const endpoint = ConstraintEndpoint.lockedToEllipse(
        ref.id,
        ref.key as Parameters<typeof ConstraintEndpoint.lockedToEllipse>[1],
      );
      return { sheet, endpoint };
    }
    case 'datum': {
      const geom = store.getByIdWithComponent(ref.id, DatumComponent);
      if (!geom) {
        return null;
      }
      const pos = DatumComponent.get(geom);
      const endpoint = ConstraintEndpoint.lockedToDatum(ref.id);
      return { sheet: pos, endpoint };
    }
    default:
      ref satisfies never;
      throw new Error(`resolveEndpoint: unknown endpoint type ${(ref as { type: string }).type}`);
  }
}

function resolveKeyPointPosition(
  geometry: Entity<GeometryComponent>,
  key: string,
): SheetPosition | null {
  const kp = GeometryComponent.keyPoints(geometry);
  const perimeterIdx = kp.perimeterLabels.indexOf(key);
  if (perimeterIdx !== -1) {
    return kp.perimeter[perimeterIdx];
  }
  const extra = kp.extras[key as keyof typeof kp.extras];
  return extra ?? null;
}

/** Executes a concrete op against the headless app. Never throws. */
export function executeOp(app: FuzzApp, op: OpRecord): Promise<OpResult> {
  switch (op.type) {
    case 'draw-polygon':
      return Promise.resolve(drawPolygon(app, op.points.map(toSheetPoint), op.closed));
    case 'draw-rectangle':
      return Promise.resolve(
        drawRectangle(app, toSheetPoint(op.first), toSheetPoint(op.second), op.centerMode),
      );
    case 'draw-ellipse':
      return Promise.resolve(
        drawEllipse(app, toSheetPoint(op.first), toSheetPoint(op.second), op.centerMode),
      );
    case 'select':
      selectIds(app, op.ids);
      return Promise.resolve({ kind: 'ok' });
    case 'clear-selection':
      app.selectionManager.clearSelection();
      return Promise.resolve({ kind: 'ok' });
    case 'translate':
      return Promise.resolve(translateShapes(app, op.ids, op.dx, op.dy));
    case 'move-vertex':
      return Promise.resolve(moveVertex(app, op.id, op.segmentIndex, toSheetPoint(op.to)));
    case 'move-control-point':
      return Promise.resolve(moveControlPoint(app, op.id, op.segmentIndex, toSheetPoint(op.to)));
    case 'insert-point-on-edge':
      return Promise.resolve(insertPointOnEdge(app, op.id, op.segmentIndex, toSheetPoint(op.pos)));
    case 'open-close-polygon':
      return executeSelectionAction(app, 'open-close-polygon', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'convert-to-polygon':
      return executeSelectionAction(app, 'convert-to-polygon', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'flip-horizontal':
      return executeSelectionAction(app, 'flip-horizontal', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'flip-vertical':
      return executeSelectionAction(app, 'flip-vertical', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'raise':
      return executeSelectionAction(app, 'raise', op.ids).then(() => ({ kind: 'ok' as const }));
    case 'lower':
      return executeSelectionAction(app, 'lower', op.ids).then(() => ({ kind: 'ok' as const }));
    case 'raise-to-top':
      return executeSelectionAction(app, 'raise-to-top', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'lower-to-bottom':
      return executeSelectionAction(app, 'lower-to-bottom', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'union':
      return executeSelectionAction(app, 'union', op.ids).then(() => ({ kind: 'ok' as const }));
    case 'difference':
      return executeSelectionAction(app, 'difference', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'intersection':
      return executeSelectionAction(app, 'intersection', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'toggle-link-dimensions':
      return executeSelectionAction(app, 'toggle-link-dimensions', op.ids).then(() => ({
        kind: 'ok' as const,
      }));
    case 'delete': {
      const existing = op.ids.filter((id) => app.geometryStore.hasId(id));
      if (existing.length === 0) {
        return Promise.resolve({ kind: 'noop', reason: 'no existing geometries to delete' });
      }
      app.historyManager.applyTransaction(
        'delete-selected',
        () => {
          for (const id of existing) {
            app.geometryStore.deleteById(id);
          }
        },
        { collapseIfSingle: true },
      );
      return Promise.resolve({ kind: 'ok' });
    }
    case 'add-linear-constraint': {
      const a = resolveEndpoint(app, op.pointA);
      const b = resolveEndpoint(app, op.pointB);
      if (!a || !b) {
        return Promise.resolve({ kind: 'noop', reason: 'endpoint not resolvable' });
      }
      app.geometryStore.add(
        ID_PREFIXES.constraint,
        LinearConstraint.create(a.endpoint, b.endpoint, Length.centimeters(op.lengthCm)),
      );
      return Promise.resolve({ kind: 'ok' });
    }
    case 'add-horizontal-constraint': {
      const a = resolveEndpoint(app, op.pointA);
      const b = resolveEndpoint(app, op.pointB);
      if (!a || !b) {
        return Promise.resolve({ kind: 'noop', reason: 'endpoint not resolvable' });
      }
      app.geometryStore.add(
        ID_PREFIXES.constraint,
        HorizontalConstraint.create(a.endpoint, b.endpoint),
      );
      return Promise.resolve({ kind: 'ok' });
    }
    case 'add-vertical-constraint': {
      const a = resolveEndpoint(app, op.pointA);
      const b = resolveEndpoint(app, op.pointB);
      if (!a || !b) {
        return Promise.resolve({ kind: 'noop', reason: 'endpoint not resolvable' });
      }
      app.geometryStore.add(
        ID_PREFIXES.constraint,
        VerticalConstraint.create(a.endpoint, b.endpoint),
      );
      return Promise.resolve({ kind: 'ok' });
    }
    case 'trim-split':
      return Promise.resolve(trimSplit(app, toSheetPoint(op.point)));
    case 'undo':
      app.historyManager.undo();
      return Promise.resolve({ kind: 'ok' });
    case 'redo':
      app.historyManager.redo();
      return Promise.resolve({ kind: 'ok' });
    case 'undo-all':
      while (app.historyManager.canUndo()) {
        app.historyManager.undo();
      }
      return Promise.resolve({ kind: 'ok' });
    case 'nudge-vertex':
      return Promise.resolve(setVertexExact(app, op.id, op.segmentIndex, toSheetPoint(op.to)));
    case 'sheet-width': {
      const current = app.sheet.width.toSheetUnits('cm').magnitude;
      if (Math.abs(current - op.cm) < 0.001) {
        return Promise.resolve({ kind: 'noop', reason: 'sheet width unchanged' });
      }
      app.sheet.updateWidth(Length.centimeters(op.cm));
      return Promise.resolve({ kind: 'ok' });
    }
    case 'sheet-height': {
      const current = app.sheet.height.toSheetUnits('cm').magnitude;
      if (Math.abs(current - op.cm) < 0.001) {
        return Promise.resolve({ kind: 'noop', reason: 'sheet height unchanged' });
      }
      app.sheet.updateHeight(Length.centimeters(op.cm));
      return Promise.resolve({ kind: 'ok' });
    }
    case 'sheet-default-unit': {
      const type = toUnitType(op.unit);
      if (!type) {
        return Promise.resolve({ kind: 'noop', reason: 'unknown unit' });
      }
      if (app.sheet.defaultUnit === type) {
        return Promise.resolve({ kind: 'noop', reason: 'sheet unit unchanged' });
      }
      app.sheet.updateDefaultUnit(type);
      return Promise.resolve({ kind: 'ok' });
    }
    case 'sheet-unit-places':
      app.sheet.updateUnitPlaces(op.places);
      return Promise.resolve({ kind: 'ok' });
    default:
      op satisfies never;
      throw new Error(`executeOp: unknown op ${(op as { type: string }).type}`);
  }
}

function toUnitType(unit: UnitName) {
  switch (unit) {
    case 'in':
      return 'in' as const;
    case 'ft':
      return 'ft' as const;
    case 'cm':
      return 'cm' as const;
    case 'mm':
      return 'mm' as const;
    case 'm':
      return 'm' as const;
    default:
      return null;
  }
}

// ============================================================
// Drawing
// ============================================================

function drawPolygon(app: FuzzApp, points: Array<SheetPosition>, closed: boolean): OpResult {
  if (points.length < 2) {
    return { kind: 'noop', reason: 'polygon needs >=2 points' };
  }
  if (minDistanceBetweenPoints(points) < EPSILON) {
    return { kind: 'noop', reason: 'polygon points must be distinct' };
  }
  app.toolManager.setActiveTool('polygon');
  for (const pt of points) {
    const screen = pt.toScreen(app.viewport);
    app.toolManager.handleMouseDown(new ScreenPosition(screen.x, screen.y), app.viewport);
  }
  if (closed) {
    // Closing via the first-handle click requires `isHoveringFirstHandle` to be
    // set (the real renderer toggles it when the cursor hovers the start handle).
    const polygonTool = app.toolManager.getTool('polygon');
    polygonTool.setHoveringFirstHandle(true);
    const screen = points[0].toScreen(app.viewport);
    app.toolManager.handleMouseMove(new ScreenPosition(screen.x, screen.y), app.viewport);
    app.toolManager.handleMouseDown(new ScreenPosition(screen.x, screen.y), app.viewport);
    polygonTool.setHoveringFirstHandle(false);
  } else {
    const lastPreview = points[0].toScreen(app.viewport);
    app.toolManager.handleMouseMove(new ScreenPosition(lastPreview.x, lastPreview.y), app.viewport);
    app.toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);
  }
  app.polishAfterOp();
  if (app.geometryStore.workingPolygon !== null) {
    return { kind: 'error', message: 'polygon drawing did not commit' };
  }
  return { kind: 'ok' };
}

function drawRectangle(
  app: FuzzApp,
  first: SheetPosition,
  second: SheetPosition,
  centerMode: boolean,
): OpResult {
  if (Math.abs(first.x - second.x) < EPSILON || Math.abs(first.y - second.y) < EPSILON) {
    return { kind: 'noop', reason: 'rectangle would be a line or degenerate' };
  }
  app.toolManager.setActiveTool('rectangle');
  if (centerMode) {
    app.toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
  }
  let firstScreen = first.toScreen(app.viewport);
  let secondScreen = second.toScreen(app.viewport);
  app.toolManager.handleMouseDown(new ScreenPosition(firstScreen.x, firstScreen.y), app.viewport);
  app.toolManager.handleMouseMove(new ScreenPosition(secondScreen.x, secondScreen.y), app.viewport);
  app.toolManager.handleMouseDown(new ScreenPosition(secondScreen.x, secondScreen.y), app.viewport);
  if (centerMode) {
    app.toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
  }
  app.polishAfterOp();
  if (app.geometryStore.workingRectangle !== null) {
    return { kind: 'error', message: 'rectangle drawing did not commit' };
  }
  return { kind: 'ok' };
}

function drawEllipse(
  app: FuzzApp,
  first: SheetPosition,
  second: SheetPosition,
  centerMode: boolean,
): OpResult {
  if (Math.abs(first.x - second.x) < EPSILON || Math.abs(first.y - second.y) < EPSILON) {
    return { kind: 'noop', reason: 'ellipse would be a line or degenerate' };
  }
  app.toolManager.setActiveTool('ellipse');
  if (centerMode) {
    app.toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
  }
  let firstScreen = first.toScreen(app.viewport);
  let secondScreen = second.toScreen(app.viewport);
  app.toolManager.handleMouseDown(new ScreenPosition(firstScreen.x, firstScreen.y), app.viewport);
  app.toolManager.handleMouseMove(new ScreenPosition(secondScreen.x, secondScreen.y), app.viewport);
  app.toolManager.handleMouseDown(new ScreenPosition(secondScreen.x, secondScreen.y), app.viewport);
  if (centerMode) {
    app.toolManager.handleKeyUp({ key: 'Alt' } as KeyboardEvent);
  }
  app.polishAfterOp();
  if (app.geometryStore.workingEllipse !== null) {
    return { kind: 'error', message: 'ellipse drawing did not commit' };
  }
  return { kind: 'ok' };
}

// ============================================================
// Editing
// ============================================================

function translateShapes(app: FuzzApp, ids: Array<string>, dx: number, dy: number): OpResult {
  if (dx === 0 && dy === 0) {
    return { kind: 'noop', reason: 'zero translation' };
  }
  const store = app.geometryStore;
  let moved = 0;
  for (const id of ids) {
    const geom = store.getByIdWithComponent(id, GeometryComponent);
    if (!geom) {
      continue;
    }
    store.updateById(id, (old) =>
      GeometryComponent.translate(old as Entity<GeometryComponent>, (p) => {
        return new SheetPosition(p.x + dx, p.y + dy);
      }),
    );
    moved += 1;
  }
  return moved > 0 ? { kind: 'ok' } : { kind: 'noop', reason: 'no geometries translated' };
}

function pointAtSegment(
  app: FuzzApp,
  id: string,
  segmentIndex: number,
): { seg: PolygonSegment; data: PolygonData } | null {
  const geom = app.geometryStore.getByIdWithComponent(id, GeometryComponent);
  if (!geom || !GeometryComponent.isPolygon(geom)) {
    return null;
  }
  const data = GeometryComponent.get(geom as Entity<GeometryComponent<PolygonData>>);
  const seg = data.points[segmentIndex];
  if (!seg) {
    return null;
  }
  return { seg, data };
}

function moveVertex(app: FuzzApp, id: string, segmentIndex: number, to: SheetPosition): OpResult {
  const found = pointAtSegment(app, id, segmentIndex);
  if (!found || found.seg.type !== 'point') {
    return { kind: 'noop', reason: 'no such polygon/vertex' };
  }
  const current = found.seg.point;
  if (current.x === to.x && current.y === to.y) {
    // Real vertex drags only record a history entry when the point actually
    // moves; mirror that so we don't manufacture bogus no-op undo entries.
    return { kind: 'noop', reason: 'vertex already at target position' };
  }
  app.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
    if (!GeometryComponent.isPolygon(old)) {
      return old;
    }
    const data = GeometryComponent.get(old);
    const points = data.points.slice();
    points[segmentIndex] = { ...points[segmentIndex], point: to };
    return GeometryComponent.update(old, { points });
  });
  return { kind: 'ok' };
}

function setVertexExact(
  app: FuzzApp,
  id: string,
  segmentIndex: number,
  to: SheetPosition,
): OpResult {
  return moveVertex(app, id, segmentIndex, to);
}

function moveControlPoint(
  app: FuzzApp,
  id: string,
  segmentIndex: number,
  to: SheetPosition,
): OpResult {
  const found = pointAtSegment(app, id, segmentIndex);
  if (!found) {
    return { kind: 'noop', reason: 'no such polygon/segment' };
  }
  const seg = found.seg;
  let current: SheetPosition | null = null;
  if (seg.type === 'arc-quadratic') {
    current = seg.controlPoint;
  } else if (seg.type === 'arc-cubic') {
    current = seg.controlPointA;
  } else {
    return { kind: 'noop', reason: 'no arc control point at segment' };
  }
  if (current.x === to.x && current.y === to.y) {
    return { kind: 'noop', reason: 'control point already at target position' };
  }
  app.geometryStore.updateByIdWithComponent(id, GeometryComponent, (old) => {
    if (!GeometryComponent.isPolygon(old)) {
      return old;
    }
    const data = GeometryComponent.get(old);
    const points = data.points.slice();
    const target = points[segmentIndex] as PolygonSegment;
    if (target.type === 'arc-quadratic') {
      points[segmentIndex] = { ...target, controlPoint: to };
    } else if (target.type === 'arc-cubic') {
      points[segmentIndex] = { ...target, controlPointA: to };
    }
    return GeometryComponent.update(old, { points });
  });
  return { kind: 'ok' };
}

function insertPointOnEdge(
  app: FuzzApp,
  id: string,
  segmentIndex: number,
  pos: SheetPosition,
): OpResult {
  const found = pointAtSegment(app, id, segmentIndex);
  if (!found || found.seg.type !== 'point') {
    return { kind: 'noop', reason: 'segment is not a point segment' };
  }
  const data = found.data;
  const next = data.points[segmentIndex + 1];
  if (!next || next.type !== 'point') {
    return { kind: 'noop', reason: 'no adjacent point segment' };
  }
  app.geometryStore.addPointOnLineSegmentEdge(id, segmentIndex, pos);
  return { kind: 'ok' };
}

// ============================================================
// Trim / split
// ============================================================

/**
 * A sheet position that is guaranteed to be a line-on-line intersection point
 * between two existing shapes' segments, or null if there is none.
 */
export function findAnySegmentIntersection(app: FuzzApp): SheetPosition | null {
  const store = app.geometryStore;
  const shapes: Array<{ id: string; data: PolygonData | RectangleData | EllipseData }> = [];
  for (const g of store.listWithComponent(GeometryComponent)) {
    const data = GeometryComponent.get(g as Entity<GeometryComponent>);
    shapes.push({ id: g.id, data });
  }

  const lines: Array<{ shapeId: string; a: SheetPosition; b: SheetPosition }> = [];
  for (const shape of shapes) {
    let segments: Array<PolygonSegment>;
    switch (shape.data.type) {
      case 'polygon':
        segments = shape.data.points;
        break;
      case 'rectangle':
        segments = rectangleToPolygon(shape.data.upperLeft, shape.data.lowerRight);
        break;
      case 'ellipse':
        segments = ellipseToPolygon(shape.data.center, shape.data.radiusX, shape.data.radiusY);
        break;
    }
    let prev: SheetPosition | null = null;
    for (const seg of segments) {
      if (seg.type !== 'point') {
        prev = seg.point;
        continue;
      }
      if (prev) {
        lines.push({ shapeId: shape.id, a: prev, b: seg.point });
      }
      prev = seg.point;
    }
    if (shape.data.type === 'polygon' && shape.data.closed && segments.length > 1 && prev) {
      lines.push({ shapeId: shape.id, a: prev, b: segments[0].point });
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[i].shapeId === lines[j].shapeId) {
        continue;
      }
      const result = computeLineSegmentIntersection(
        { start: lines[i].a, end: lines[i].b } as LineSegment<SheetPosition>,
        { start: lines[j].a, end: lines[j].b } as LineSegment<SheetPosition>,
      );
      if (result) {
        return result[0];
      }
    }
  }
  return null;
}

function trimSplit(app: FuzzApp, point: SheetPosition): OpResult {
  // On this build, trim-split lives inside the "edit" multi-tool.
  app.toolManager.setActiveTool('edit' as never);
  app.toolManager.changeToolSubTool('edit' as never, 'trim-split');
  const screen = point.toScreen(app.viewport);
  app.toolManager.handleMouseMove(new ScreenPosition(screen.x, screen.y), app.viewport);
  app.toolManager.handleMouseDown(new ScreenPosition(screen.x, screen.y), app.viewport);
  app.polishAfterOp();
  return { kind: 'ok' };
}

// ============================================================
// Human-readable description (for the judge)
// ============================================================

function formatPoint(p: Point): string {
  const rx = Math.round(p.x * 1000) / 1000;
  const ry = Math.round(p.y * 1000) / 1000;
  return `(${rx}, ${ry})`;
}

export function describeOp(op: OpRecord): string {
  switch (op.type) {
    case 'draw-polygon':
      return `Drew a ${op.closed ? 'closed' : 'open'} polygon with vertices: ${op.points
        .map(formatPoint)
        .join(', ')}.`;
    case 'draw-rectangle':
      return `Drew a ${op.centerMode ? 'center-mode' : 'corner-mode'} rectangle from ${formatPoint(
        op.first,
      )} to ${formatPoint(op.second)}.`;
    case 'draw-ellipse':
      return `Drew an ${op.centerMode ? 'center-mode' : 'corner-mode'} ellipse from ${formatPoint(
        op.first,
      )} to ${formatPoint(op.second)}.`;
    case 'select':
      return `Selected geometries: ${op.ids.join(', ')}.`;
    case 'clear-selection':
      return 'Cleared the selection.';
    case 'translate':
      return `Translated geometry ${op.ids.join(', ')} by (${op.dx}, ${op.dy}).`;
    case 'move-vertex':
      return `Moved vertex #${op.segmentIndex} of ${op.id} to ${formatPoint(op.to)}.`;
    case 'move-control-point':
      return `Moved the arc control point #${op.segmentIndex} of ${op.id} to ${formatPoint(op.to)}.`;
    case 'insert-point-on-edge':
      return `Inserted a point at ${formatPoint(op.pos)} on edge #${op.segmentIndex} of ${op.id}.`;
    case 'open-close-polygon':
      return `Toggled open/close of ${op.ids.join(', ')}.`;
    case 'convert-to-polygon':
      return `Converted ${op.ids.join(', ')} to polygon.`;
    case 'flip-horizontal':
      return `Flipped ${op.ids.join(', ')} horizontally.`;
    case 'flip-vertical':
      return `Flipped ${op.ids.join(', ')} vertically.`;
    case 'raise':
      return `Raised ${op.ids.join(', ')}.`;
    case 'lower':
      return `Lowered ${op.ids.join(', ')}.`;
    case 'raise-to-top':
      return `Raised ${op.ids.join(', ')} to top.`;
    case 'lower-to-bottom':
      return `Lowered ${op.ids.join(', ')} to bottom.`;
    case 'union':
      return `Union of ${op.ids.join(', ')}.`;
    case 'difference':
      return `Difference of ${op.ids.join(', ')}.`;
    case 'intersection':
      return `Intersection of ${op.ids.join(', ')}.`;
    case 'toggle-link-dimensions':
      return `Toggled link-dimensions on ${op.ids.join(', ')}.`;
    case 'delete':
      return `Deleted ${op.ids.join(', ')}.`;
    case 'add-linear-constraint':
      return `Added a ${op.lengthCm}cm linear constraint between ${describeEndpoint(op.pointA)} and ${describeEndpoint(op.pointB)}.`;
    case 'add-horizontal-constraint':
      return `Added a horizontal constraint between ${describeEndpoint(op.pointA)} and ${describeEndpoint(op.pointB)}.`;
    case 'add-vertical-constraint':
      return `Added a vertical constraint between ${describeEndpoint(op.pointA)} and ${describeEndpoint(op.pointB)}.`;
    case 'trim-split':
      return `Trimmed/Split geometry at ${formatPoint(op.point)}.`;
    case 'undo':
      return 'Undid the previous operation.';
    case 'redo':
      return 'Redid the previously undone operation.';
    case 'undo-all':
      return 'Undid everything.';
    case 'nudge-vertex':
      return `Precisely moved vertex #${op.segmentIndex} of ${op.id} to ${formatPoint(op.to)}.`;
    case 'sheet-width':
      return `Changed sheet width to ${op.cm}cm.`;
    case 'sheet-height':
      return `Changed sheet height to ${op.cm}cm.`;
    case 'sheet-default-unit':
      return `Changed sheet default unit to ${op.unit}.`;
    case 'sheet-unit-places':
      return `Changed sheet unit places to ${op.places}.`;
    default:
      op satisfies never;
      return `Unknown op ${(op as { type: string }).type}`;
  }
}

function describeEndpoint(ref: EndpointRef): string {
  switch (ref.type) {
    case 'free':
      return `free point ${formatPoint(ref)}`;
    case 'polygon-vertex':
      return `vertex #${ref.index} of ${ref.id}`;
    case 'rectangle-keypoint':
      return `rectangle keypoint '${ref.key}' of ${ref.id}`;
    case 'ellipse-keypoint':
      return `ellipse keypoint '${ref.key}' of ${ref.id}`;
    case 'datum':
      return `datum ${ref.id}`;
    default:
      ref satisfies never;
      return 'unknown endpoint';
  }
}

// ============================================================
// Random op picking (state-aware)
// ============================================================

function listGeometries(app: FuzzApp) {
  return app.geometryStore.listWithComponent(GeometryComponent);
}

function listPolygons(app: FuzzApp) {
  return app.geometryStore
    .listWithComponent(GeometryComponent)
    .filter((g) => GeometryComponent.isPolygon(g as Entity<GeometryComponent>));
}

function randomGeometryKeypoint(app: FuzzApp, id: string): EndpointRef | null {
  const geom = app.geometryStore.getByIdWithComponent(id, GeometryComponent);
  if (!geom) {
    return null;
  }
  if (GeometryComponent.isPolygon(geom)) {
    const data = GeometryComponent.get(geom);
    return { type: 'polygon-vertex', id, index: app.rng.index(data.points.length) };
  }
  if (GeometryComponent.isRectangle(geom)) {
    const keys = ['upperLeft', 'upperRight', 'lowerLeft', 'lowerRight', 'center'];
    return { type: 'rectangle-keypoint', id, key: app.rng.pick(keys) as RectangleKeypointKey };
  }
  if (GeometryComponent.isEllipse(geom)) {
    const keys = ['center', 'right', 'left', 'top', 'bottom'];
    return { type: 'ellipse-keypoint', id, key: app.rng.pick(keys) };
  }
  return null;
}

/** Picks a random concrete op based on the current app state, or null to skip. */
export function pickRandomOp(app: FuzzApp, rng: PRNG): OpRecord | null {
  const sheetW = Math.max(app.sheet.width.toSheetUnits(app.sheet.defaultUnit).magnitude - 2, 2);
  const sheetH = Math.max(app.sheet.height.toSheetUnits(app.sheet.defaultUnit).magnitude - 2, 2);

  const geometries = listGeometries(app).map((g) => g.id);
  const polygons = listPolygons(app) as Array<Entity<GeometryComponent<PolygonData>>>;

  const WEIGHTS: Array<[OpRecord['type'], number]> = [
    ['draw-polygon', 6],
    ['draw-rectangle', 4],
    ['draw-ellipse', 4],
    ['translate', 6],
    ['move-vertex', 5],
    ['insert-point-on-edge', 3],
    ['delete', 3],
    ['union', 3],
    ['difference', 3],
    ['intersection', 2],
    ['open-close-polygon', 2],
    ['convert-to-polygon', 2],
    ['flip-horizontal', 1],
    ['flip-vertical', 1],
    ['raise', 1],
    ['lower', 1],
    ['raise-to-top', 1],
    ['lower-to-bottom', 1],
    ['toggle-link-dimensions', 1],
    ['add-linear-constraint', 3],
    ['add-horizontal-constraint', 2],
    ['add-vertical-constraint', 2],
    ['trim-split', 3],
    ['undo', 2],
    ['redo', 2],
    ['undo-all', 1],
    ['select', 2],
    ['clear-selection', 1],
    ['sheet-width', 1],
    ['sheet-height', 1],
    ['sheet-default-unit', 1],
    ['sheet-unit-places', 1],
  ];

  const weighted: Array<OpRecord['type']> = [];
  for (const [name, weight] of WEIGHTS) {
    for (let i = 0; i < weight; i += 1) {
      weighted.push(name);
    }
  }

  let opType = rng.pick(weighted);

  // Retry a bounded number of times if the picked op is not feasible right now.
  for (let attempts = 0; attempts < 20; attempts += 1) {
    switch (opType) {
      case 'draw-polygon': {
        if (geometries.length > 30) {
          break;
        }
        const n = rng.int(3, 6);
        const pts = randomSheetPoints(app, n).map((p) => ({ x: p.x, y: p.y }));
        if (pts.length < n) {
          break;
        }
        return { type: 'draw-polygon', points: pts, closed: rng.chance(0.6) };
      }
      case 'draw-rectangle': {
        if (geometries.length > 30) {
          break;
        }
        return {
          type: 'draw-rectangle',
          first: { x: rng.range(0.5, sheetW), y: rng.range(0.5, sheetH) },
          second: { x: rng.range(0.5, sheetW), y: rng.range(0.5, sheetH) },
          centerMode: rng.chance(0.2),
        };
      }
      case 'draw-ellipse': {
        if (geometries.length > 30) {
          break;
        }
        return {
          type: 'draw-ellipse',
          first: { x: rng.range(0.5, sheetW), y: rng.range(0.5, sheetH) },
          second: { x: rng.range(0.5, sheetW), y: rng.range(0.5, sheetH) },
          centerMode: rng.chance(0.2),
        };
      }
      case 'translate': {
        if (geometries.length === 0) {
          break;
        }
        const ids = rng.shuffle(geometries).slice(0, rng.int(1, Math.min(3, geometries.length)));
        return { type: 'translate', ids, dx: rng.range(-4, 4), dy: rng.range(-4, 4) };
      }
      case 'move-vertex': {
        if (polygons.length === 0) {
          break;
        }
        const poly = rng.pick(polygons);
        const data = GeometryComponent.get(poly);
        if (data.points.length === 0) {
          break;
        }
        return {
          type: 'move-vertex',
          id: poly.id,
          segmentIndex: rng.index(data.points.length),
          to: { x: rng.range(0.5, sheetW), y: rng.range(0.5, sheetH) },
        };
      }
      case 'insert-point-on-edge': {
        if (polygons.length === 0) {
          break;
        }
        const poly = rng.pick(polygons);
        const data = GeometryComponent.get(poly);
        for (let i = 0; i < data.points.length - 1; i += 1) {
          const a = data.points[i];
          const b = data.points[i + 1];
          if (a.type === 'point' && b.type === 'point') {
            return {
              type: 'insert-point-on-edge',
              id: poly.id,
              segmentIndex: i,
              pos: { x: (a.point.x + b.point.x) / 2, y: (a.point.y + b.point.y) / 2 },
            };
          }
        }
        break;
      }
      case 'delete': {
        if (geometries.length === 0) {
          break;
        }
        const ids = rng.shuffle(geometries).slice(0, rng.int(1, Math.min(3, geometries.length)));
        return { type: 'delete', ids };
      }
      case 'union':
      case 'difference':
      case 'intersection': {
        if (geometries.length < 2) {
          break;
        }
        const ids = rng.shuffle(geometries).slice(0, rng.int(2, Math.min(4, geometries.length)));
        return { type: opType, ids };
      }
      case 'open-close-polygon': {
        if (polygons.length === 0) {
          break;
        }
        return {
          type: 'open-close-polygon',
          ids: [rng.shuffle(polygons)[0].id],
        };
      }
      case 'convert-to-polygon': {
        const convertible = geometries.filter((id) => {
          const g = app.geometryStore.getByIdWithComponent(id, GeometryComponent);
          return g && (GeometryComponent.isRectangle(g) || GeometryComponent.isEllipse(g));
        });
        if (convertible.length === 0) {
          break;
        }
        return { type: 'convert-to-polygon', ids: [rng.pick(convertible)] };
      }
      case 'flip-horizontal':
      case 'flip-vertical': {
        if (polygons.length === 0) {
          break;
        }
        return { type: opType, ids: [rng.shuffle(polygons)[0].id] };
      }
      case 'raise':
      case 'lower':
      case 'raise-to-top':
      case 'lower-to-bottom':
      case 'toggle-link-dimensions': {
        if (geometries.length === 0) {
          break;
        }
        const ids = rng.shuffle(geometries).slice(0, rng.int(1, Math.min(2, geometries.length)));
        return { type: opType, ids };
      }
      case 'add-linear-constraint':
      case 'add-horizontal-constraint':
      case 'add-vertical-constraint': {
        if (geometries.length === 0) {
          break;
        }
        const id = rng.pick(geometries);
        const a = randomGeometryKeypoint(app, id);
        if (!a) {
          break;
        }
        const b: EndpointRef = {
          type: 'free',
          x: rng.range(0.5, sheetW),
          y: rng.range(0.5, sheetH),
        };
        if (opType === 'add-linear-constraint') {
          return {
            type: 'add-linear-constraint',
            pointA: a,
            pointB: b,
            lengthCm: Math.round(rng.range(0.5, 10) * 10) / 10,
          };
        }
        if (opType === 'add-horizontal-constraint') {
          return { type: 'add-horizontal-constraint', pointA: a, pointB: b };
        }
        return { type: 'add-vertical-constraint', pointA: a, pointB: b };
      }
      case 'trim-split': {
        const intersection = findAnySegmentIntersection(app);
        if (!intersection) {
          break;
        }
        return {
          type: 'trim-split',
          point: { x: intersection.x, y: intersection.y },
        };
      }
      case 'undo':
        if (!app.historyManager.canUndo()) {
          break;
        }
        return { type: 'undo' };
      case 'redo':
        if (!app.historyManager.canRedo()) {
          break;
        }
        return { type: 'redo' };
      case 'undo-all':
        if (!app.historyManager.canUndo()) {
          break;
        }
        return { type: 'undo-all' };
      case 'select': {
        if (geometries.length === 0) {
          break;
        }
        const ids = rng.shuffle(geometries).slice(0, rng.int(1, Math.min(3, geometries.length)));
        return { type: 'select', ids };
      }
      case 'clear-selection':
        return { type: 'clear-selection' };
      case 'sheet-width':
        return { type: 'sheet-width', cm: rng.int(10, 200) };
      case 'sheet-height':
        return { type: 'sheet-height', cm: rng.int(10, 300) };
      case 'sheet-default-unit':
        return { type: 'sheet-default-unit', unit: rng.pick(['in', 'ft', 'cm', 'mm', 'm']) };
      case 'sheet-unit-places':
        return { type: 'sheet-unit-places', places: rng.int(1, 6) };
    }

    // Not feasible this time: pick a different op type and retry.
    opType = rng.pick(weighted);
  }

  return null;
}
