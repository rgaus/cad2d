import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  Ellipse,
  GeometryComponent,
  LinkDimensionsComponent,
  Polygon,
  type PolygonSegment,
  Rectangle,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
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

describe('ToggleLinkDimensionsAction', () => {
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

  it('toggles linkDimensions on a rectangle', async () => {
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

    await actionsManager.execute('toggle-link-dimensions');

    const rect = geometryStore.getByIdWithComponents(
      rectId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    expect(rect).not.toBeNull();
    expect(LinkDimensionsComponent.get(rect!)).toBe(true);
  });

  it('sets both dimensions to max(W,H) when linking a rectangle', async () => {
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

    await actionsManager.execute('toggle-link-dimensions');

    const rect = geometryStore.getByIdWithComponents(
      rectId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    expect(rect).not.toBeNull();
    expect(LinkDimensionsComponent.get(rect!)).toBe(true);
    expect(
      GeometryComponent.get(rect!).lowerRight.x - GeometryComponent.get(rect!).upperLeft.x,
    ).toBe(20);
    expect(
      GeometryComponent.get(rect!).lowerRight.y - GeometryComponent.get(rect!).upperLeft.y,
    ).toBe(20);
  });

  it('supports undo/redo on a rectangle', async () => {
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

    await actionsManager.execute('toggle-link-dimensions');
    expect(
      LinkDimensionsComponent.get(
        geometryStore.getByIdWithComponents(rectId, GeometryComponent, LinkDimensionsComponent)!,
      ),
    ).toBe(true);

    historyManager.undo();
    expect(
      LinkDimensionsComponent.get(
        geometryStore.getByIdWithComponents(rectId, GeometryComponent, LinkDimensionsComponent)!,
      ),
    ).toBe(false);
    expect(
      GeometryComponent.get(
        geometryStore.getByIdWithComponents(rectId, GeometryComponent, LinkDimensionsComponent)!,
      ).lowerRight.x,
    ).toBe(10);
    expect(
      GeometryComponent.get(
        geometryStore.getByIdWithComponents(rectId, GeometryComponent, LinkDimensionsComponent)!,
      ).lowerRight.y,
    ).toBe(20);

    historyManager.redo();
    expect(
      LinkDimensionsComponent.get(
        geometryStore.getByIdWithComponents(rectId, GeometryComponent, LinkDimensionsComponent)!,
      ),
    ).toBe(true);
  });

  it('toggles linkDimensions on an ellipse', async () => {
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

    await actionsManager.execute('toggle-link-dimensions');

    const ellipse = geometryStore.getByIdWithComponents(
      ellipseId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    expect(ellipse).not.toBeNull();
    expect(LinkDimensionsComponent.get(ellipse!)).toBe(true);
  });

  it('sets RY = RX when linking an ellipse', async () => {
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

    await actionsManager.execute('toggle-link-dimensions');

    const ellipse = geometryStore.getByIdWithComponents(
      ellipseId,
      GeometryComponent,
      LinkDimensionsComponent,
    );
    expect(ellipse).not.toBeNull();
    expect(LinkDimensionsComponent.get(ellipse!)).toBe(true);
    expect(GeometryComponent.get(ellipse!).radiusX).toBe(10);
    expect(GeometryComponent.get(ellipse!).radiusY).toBe(10);
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('toggle-link-dimensions');
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

    const action = actionsManager.getAction('toggle-link-dimensions');
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

    const action = actionsManager.getAction('toggle-link-dimensions');
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

    const action = actionsManager.getAction('toggle-link-dimensions');
    expect(action.disabled).toBe(false);
  });
});
