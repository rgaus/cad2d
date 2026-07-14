import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  FillColorComponent,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/geometry/colors';
import { ConstraintEndpoint, LinearConstraint } from '@/lib/geometry/constraints';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';

function makeClosedPolygonPoints(): Array<PolygonSegment> {
  return [
    { type: 'point' as const, point: new SheetPosition(0, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 10) },
    { type: 'point' as const, point: new SheetPosition(0, 0) },
  ];
}

function makeOpenPolygonPoints(): Array<PolygonSegment> {
  return [
    { type: 'point' as const, point: new SheetPosition(0, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 10) },
  ];
}

function makePolygon(overrides: {
  id: string;
  points: Array<PolygonSegment>;
  closed?: boolean;
  fillColor?: number | null;
  openAtIndex?: number;
  renderOrder?: number;
}): Polygon {
  const template = Polygon.create(overrides.points, {
    closed: overrides.closed,
    fillColor: overrides.fillColor,
    openAtIndex: overrides.openAtIndex,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

function makeRectangle(overrides: {
  id: string;
  upperLeft: SheetPosition;
  lowerRight: SheetPosition;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Rectangle {
  const template = Rectangle.create(overrides.upperLeft, overrides.lowerRight, {
    fillColor: overrides.fillColor,
    linkDimensions: overrides.linkDimensions,
  });
  const renderOrder = overrides.renderOrder ?? 0;
  return {
    id: overrides.id,
    ...template,
    components: {
      ...template.components,
      ...RenderOrderComponent.create(renderOrder),
    },
  };
}

describe('OpenClosePolygonAction', () => {
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let historyManager: HistoryManager;
  let toolManager: ToolManager;
  let actionsManager: ActionsManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(
      Sheet.a4(),
      geometryStore,
      selectionManager,
      historyManager,
    );
    actionsManager.setToolManager(toolManager);
  });

  it('opens a closed polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');

    const polygon = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(polygon).not.toBeNull();
    expect(PolygonComponent.get(polygon!).closed).toBe(false);

    // Fill color should be unset after a polygon is opened
    expect(FillColorComponent.getOptional(polygon!)).toBeUndefined();
  });

  it('closes an open polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeOpenPolygonPoints(),
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');

    const polygon = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(polygon).not.toBeNull();
    expect(PolygonComponent.get(polygon!).closed).toBe(true);

    // Fill color should set to the default when the polygon is opened up
    expect(FillColorComponent.getOptional(polygon!)).toBe(DEFAULT_COLOR);
  });

  it('polygon going through closed -> open -> closed cycle keeps fill color', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: 3900150,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');

    // Make sure polygon is now open
    let polygon = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(polygon).not.toBeNull();
    expect(PolygonComponent.get(polygon!).closed).toBe(false);
    // Make sure fill color components is gone
    expect(FillColorComponent.getOptional(polygon!)).toBeUndefined();

    await actionsManager.execute('open-close-polygon');

    // Make sure polygon is now closed
    polygon = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(polygon).not.toBeNull();
    expect(PolygonComponent.get(polygon!).closed).toBe(true);
    // Fill color should set back to the original value
    expect(FillColorComponent.getOptional(polygon!)).toBe(3900150);
  });

  it('supports undo/redo cycle', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');
    expect(
      PolygonComponent.get(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)!).closed,
    ).toBe(false);

    historyManager.undo();
    expect(
      PolygonComponent.get(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)!).closed,
    ).toBe(true);

    historyManager.redo();
    expect(
      PolygonComponent.get(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)!).closed,
    ).toBe(false);
  });

  it('is disabled when no polygon is selected', () => {
    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(true);
  });

  it('remaps locked-polygon constraint pointIndex when opening a closed polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    // Closed triangle: [P0, P1, P2, P0_dup]
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    // Constraint locked to P0 (index 0) and P1 (index 1)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, 0),
        ConstraintEndpoint.lockedToPolygon(polygonId, 1),
        Length.centimeters(10),
      ),
    );

    await actionsManager.execute('open-close-polygon');

    const constraints = geometryStore.findConstraintsByGeometryId(polygonId);
    expect(constraints).toHaveLength(1);

    const constraint = constraints[0] as LinearConstraint;
    // After opening at openAtIndex=0, the open polygon is [P1, P2, P0]
    // P0 was at index 0, now at index 2
    // P1 was at index 1, now at index 0
    expect(constraint.pointA.type).toBe('locked-polygon');
    expect((constraint.pointA as any).pointIndex).toBe(2);
    expect(constraint.pointB.type).toBe('locked-polygon');
    expect((constraint.pointB as any).pointIndex).toBe(0);
  });

  it('remaps locked-polygon constraint pointIndex when closing an open polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    // Open triangle: [P1, P2, P0] (after opening at openAtIndex=0)
    const openPoints: Array<PolygonSegment> = [
      { type: 'point' as const, point: new SheetPosition(10, 0) },
      { type: 'point' as const, point: new SheetPosition(10, 10) },
      { type: 'point' as const, point: new SheetPosition(0, 0) },
    ];
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: openPoints,
        closed: false,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    // Constraint locked to P0 (index 2 in open) and P1 (index 0 in open)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, 2),
        ConstraintEndpoint.lockedToPolygon(polygonId, 0),
        Length.centimeters(10),
      ),
    );

    await actionsManager.execute('open-close-polygon');

    const constraints = geometryStore.findConstraintsByGeometryId(polygonId);
    expect(constraints).toHaveLength(1);

    const constraint = constraints[0] as LinearConstraint;
    // After closing, [P0, P1, P2, P0_dup]
    // P0 (was index 2 in open) -> index 0
    // P1 (was index 0 in open) -> index 1
    expect(constraint.pointA.type).toBe('locked-polygon');
    expect((constraint.pointA as any).pointIndex).toBe(0);
    expect(constraint.pointB.type).toBe('locked-polygon');
    expect((constraint.pointB as any).pointIndex).toBe(1);
  });

  it('open -> close -> open round trip restores constraint pointIndices', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    // Closed triangle: [P0, P1, P2, P0_dup]
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    // Constraint locked to P2 (index 2)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, 2),
        ConstraintEndpoint.point(new SheetPosition(0, 0)),
        Length.centimeters(10),
      ),
    );

    // Open: P2 should map to index 1 in [P1, P2, P0]
    await actionsManager.execute('open-close-polygon');
    let constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect(constraint.pointA.type).toBe('locked-polygon');
    expect((constraint.pointA as any).pointIndex).toBe(1);

    // Close: P2 should map back to index 2
    await actionsManager.execute('open-close-polygon');
    constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect(constraint.pointA.type).toBe('locked-polygon');
    expect((constraint.pointA as any).pointIndex).toBe(2);

    // Open again: P2 should map to index 1 again
    await actionsManager.execute('open-close-polygon');
    constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect(constraint.pointA.type).toBe('locked-polygon');
    expect((constraint.pointA as any).pointIndex).toBe(1);
  });

  it('undo/redo cycle restores constraint pointIndices after open', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    // Constraint locked to P1 (index 1) and P2 (index 2)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, 1),
        ConstraintEndpoint.lockedToPolygon(polygonId, 2),
        Length.centimeters(10),
      ),
    );

    await actionsManager.execute('open-close-polygon');

    // After opening: P1 at index 0, P2 at index 1
    let constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect((constraint.pointA as any).pointIndex).toBe(0);
    expect((constraint.pointB as any).pointIndex).toBe(1);

    // Undo: polygon should be closed again, indices restored
    historyManager.undo();
    constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect((constraint.pointA as any).pointIndex).toBe(1);
    expect((constraint.pointB as any).pointIndex).toBe(2);

    // Redo: polygon open again, indices shifted
    historyManager.redo();
    constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect((constraint.pointA as any).pointIndex).toBe(0);
    expect((constraint.pointB as any).pointIndex).toBe(1);
  });

  it('remaps constraints when opening at non-zero openAtIndex', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    // Closed triangle: [P0, P1, P2, P0_dup] with openAtIndex=1
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 1,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    // Constraint locked to P0 (index 0) and P2 (index 2)
    geometryStore.addConstraint(
      LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, 0),
        ConstraintEndpoint.lockedToPolygon(polygonId, 2),
        Length.centimeters(10),
      ),
    );

    await actionsManager.execute('open-close-polygon');

    // After opening at openAtIndex=1, open polygon is [P2, P0, P1]
    // P0 (old 0 <= 1): new = 0 + (4-2-1) = 1
    // P2 (old 2 > 1): new = 2 - (1+1) = 0
    const constraint = geometryStore.findConstraintsByGeometryId(polygonId)[0] as LinearConstraint;
    expect((constraint.pointA as any).pointIndex).toBe(1);
    expect((constraint.pointB as any).pointIndex).toBe(0);
  });

  it('is enabled when exactly one polygon is selected', () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addDirect(
      makePolygon({
        id: polygonId,
        points: makeClosedPolygonPoints(),
        closed: true,
        fillColor: null,
        openAtIndex: 0,
        renderOrder: 0,
      }),
    );
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(false);
  });
});
