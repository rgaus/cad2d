import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SheetPosition } from '@/lib/viewport/types';
import { type PolygonSegment } from '@/lib/geometry';

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
    actionsManager = new ActionsManager(Sheet.a4(), geometryStore, selectionManager, historyManager);
    actionsManager.setToolManager(toolManager);
  });

  it('opens a closed polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addPolygonDirect({
      id: polygonId,
      points: makeClosedPolygonPoints(),
      closed: true,
      fillColor: null,
      openAtIndex: 0,
      renderOrder: 0,
    });
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');

    const polygon = geometryStore.getPolygonById(polygonId);
    expect(polygon).not.toBeNull();
    expect(polygon!.closed).toBe(false);
  });

  it('closes an open polygon', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addPolygonDirect({
      id: polygonId,
      points: makeOpenPolygonPoints(),
      closed: false,
      fillColor: null,
      openAtIndex: 0,
      renderOrder: 0,
    });
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');

    const polygon = geometryStore.getPolygonById(polygonId);
    expect(polygon).not.toBeNull();
    expect(polygon!.closed).toBe(true);
  });

  it('supports undo/redo cycle', async () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addPolygonDirect({
      id: polygonId,
      points: makeClosedPolygonPoints(),
      closed: true,
      fillColor: null,
      openAtIndex: 0,
      renderOrder: 0,
    });
    selectionManager.select(polygonId);

    await actionsManager.execute('open-close-polygon');
    expect(geometryStore.getPolygonById(polygonId)!.closed).toBe(false);

    historyManager.undo();
    expect(geometryStore.getPolygonById(polygonId)!.closed).toBe(true);

    historyManager.redo();
    expect(geometryStore.getPolygonById(polygonId)!.closed).toBe(false);
  });

  it('is disabled when no polygon is selected', () => {
    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 10),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when exactly one polygon is selected', () => {
    const polygonId = historyManager.generateStableId(ID_PREFIXES.polygon);
    geometryStore.addPolygonDirect({
      id: polygonId,
      points: makeClosedPolygonPoints(),
      closed: true,
      fillColor: null,
      openAtIndex: 0,
      renderOrder: 0,
    });
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('open-close-polygon');
    expect(action.disabled).toBe(false);
  });
});
