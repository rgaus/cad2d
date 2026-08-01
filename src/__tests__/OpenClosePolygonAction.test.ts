import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  FillColorComponent,
  GeometryComponent,
  Polygon,
  type PolygonSegment,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
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

    const polygon = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    expect(polygon).not.toBeNull();
    expect(GeometryComponent.get(polygon!).closed).toBe(false);

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

    const polygon = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    expect(polygon).not.toBeNull();
    expect(GeometryComponent.get(polygon!).closed).toBe(true);

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
    let polygon = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    expect(polygon).not.toBeNull();
    expect(GeometryComponent.get(polygon!).closed).toBe(false);
    // Make sure fill color components is gone
    expect(FillColorComponent.getOptional(polygon!)).toBeUndefined();

    await actionsManager.execute('open-close-polygon');

    // Make sure polygon is now closed
    polygon = geometryStore.getByIdWithComponent(polygonId, GeometryComponent);
    expect(polygon).not.toBeNull();
    expect(GeometryComponent.get(polygon!).closed).toBe(true);
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
      GeometryComponent.get(geometryStore.getByIdWithComponent(polygonId, GeometryComponent)!)
        .closed,
    ).toBe(false);

    historyManager.undo();
    expect(
      GeometryComponent.get(geometryStore.getByIdWithComponent(polygonId, GeometryComponent)!)
        .closed,
    ).toBe(true);

    historyManager.redo();
    expect(
      GeometryComponent.get(geometryStore.getByIdWithComponent(polygonId, GeometryComponent)!)
        .closed,
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
