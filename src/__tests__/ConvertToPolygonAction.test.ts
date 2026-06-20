import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  Ellipse,
  EllipseComponent,
  type PerpendicularConstraint,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  Rectangle,
  RectangleComponent,
  RenderOrderComponent,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

function makeClosedPolygonPoints(): Array<PolygonSegment> {
  return [
    { type: 'point' as const, point: new SheetPosition(0, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 0) },
    { type: 'point' as const, point: new SheetPosition(10, 10) },
    { type: 'point' as const, point: new SheetPosition(0, 0) },
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

function makeEllipse(overrides: {
  id: string;
  center: SheetPosition;
  radiusX: number;
  radiusY: number;
  fillColor?: number | null;
  linkDimensions?: boolean;
  renderOrder?: number;
}): Ellipse {
  const template = Ellipse.create(overrides.center, {
    radiusX: overrides.radiusX,
    radiusY: overrides.radiusY,
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

describe('ConvertToPolygonAction', () => {
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

  it('converts a rectangle to a polygon', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);

    const polygon = geometryStore.listWithComponent(PolygonComponent)[0];
    expect(geometryStore.constraints).toHaveLength(4);
    for (const c of geometryStore.constraints) {
      expect(c.type).toStrictEqual('perpendicular');
      const pc = c as PerpendicularConstraint;
      expect(pc.pointA.type).toStrictEqual('locked-polygon');
      expect((pc.pointA as any).id).toBe(polygon.id);
      expect(pc.pointCenter.type).toStrictEqual('locked-polygon');
      expect((pc.pointCenter as any).id).toBe(polygon.id);
      expect(pc.pointB.type).toStrictEqual('locked-polygon');
      expect((pc.pointB as any).id).toBe(polygon.id);
    }

    // Verify corner pointIndex assignments
    // rectangleToPolygon produces: [0]=UL, [1]=UR, [2]=LR, [3]=LL, [4]=UL(dup)
    // Constraints are: (0,1,2) = UR corner, (1,2,3) = LR corner, (2,3,4) = LL corner, (3,0,1) = UL corner
    const expectedCornerIndices = [
      { pointA: 0, pointCenter: 1, pointB: 2 },
      { pointA: 1, pointCenter: 2, pointB: 3 },
      { pointA: 2, pointCenter: 3, pointB: 4 },
      { pointA: 3, pointCenter: 0, pointB: 1 },
    ];
    for (let i = 0; i < 4; i += 1) {
      const pc = geometryStore.constraints[i] as PerpendicularConstraint;
      expect((pc.pointA as any).pointIndex).toBe(expectedCornerIndices[i].pointA);
      expect((pc.pointCenter as any).pointIndex).toBe(expectedCornerIndices[i].pointCenter);
      expect((pc.pointB as any).pointIndex).toBe(expectedCornerIndices[i].pointB);
    }
  });

  it('converts an ellipse to a polygon', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.listWithComponent(PolygonComponent).length).toBe(1);
  });

  it('updates selection to the new polygon', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');

    const selectedIds = selectionManager.getSelectedIds();
    expect(selectedIds).toHaveLength(1);
    expect(selectedIds[0]).not.toBe(rectId);
    expect(geometryStore.getByIdWithComponent(selectedIds[0], PolygonComponent)).not.toBeNull();
  });

  it('supports undo/redo for rectangle conversion', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.listWithComponent(PolygonComponent)[0].id;
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
    expect(geometryStore.constraints).toHaveLength(4);
    expect(geometryStore.constraints.every((c) => c.type === 'perpendicular')).toBe(true);

    historyManager.undo();
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).not.toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).toBeNull();
    expect(geometryStore.constraints).toHaveLength(0);

    historyManager.redo();
    expect(geometryStore.getByIdWithComponent(rectId, RectangleComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
    expect(geometryStore.constraints).toHaveLength(4);
    expect(geometryStore.constraints.every((c) => c.type === 'perpendicular')).toBe(true);
  });

  it('supports undo/redo for ellipse conversion', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.listWithComponent(PolygonComponent)[0].id;
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).not.toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getByIdWithComponent(ellipseId, EllipseComponent)).toBeNull();
    expect(geometryStore.getByIdWithComponent(polygonId, PolygonComponent)).not.toBeNull();
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a polygon is selected', () => {
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

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when exactly one rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addDirect(
      makeRectangle({
        id: rectId,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 20),
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(rectId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });

  it('is enabled when exactly one ellipse is selected', () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addDirect(
      makeEllipse({
        id: ellipseId,
        center: new SheetPosition(0, 0),
        radiusX: 10,
        radiusY: 20,
        fillColor: null,
        linkDimensions: false,
        renderOrder: 0,
      }),
    );
    selectionManager.select(ellipseId);

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });
});
