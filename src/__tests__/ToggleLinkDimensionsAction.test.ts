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
    actionsManager = new ActionsManager(Sheet.a4(), geometryStore, selectionManager, historyManager);
    actionsManager.setToolManager(toolManager);
  });

  it('toggles linkDimensions on a rectangle', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('toggle-link-dimensions');

    const rect = geometryStore.getRectangleById(rectId);
    expect(rect).not.toBeNull();
    expect(rect!.linkDimensions).toBe(true);
  });

  it('sets both dimensions to max(W,H) when linking a rectangle', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('toggle-link-dimensions');

    const rect = geometryStore.getRectangleById(rectId);
    expect(rect).not.toBeNull();
    expect(rect!.linkDimensions).toBe(true);
    expect(rect!.lowerRight.x - rect!.upperLeft.x).toBe(20);
    expect(rect!.lowerRight.y - rect!.upperLeft.y).toBe(20);
  });

  it('supports undo/redo on a rectangle', async () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    await actionsManager.execute('toggle-link-dimensions');
    expect(geometryStore.getRectangleById(rectId)!.linkDimensions).toBe(true);

    historyManager.undo();
    expect(geometryStore.getRectangleById(rectId)!.linkDimensions).toBe(false);
    expect(geometryStore.getRectangleById(rectId)!.lowerRight.x).toBe(10);
    expect(geometryStore.getRectangleById(rectId)!.lowerRight.y).toBe(20);

    historyManager.redo();
    expect(geometryStore.getRectangleById(rectId)!.linkDimensions).toBe(true);
  });

  it('toggles linkDimensions on an ellipse', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    await actionsManager.execute('toggle-link-dimensions');

    const ellipse = geometryStore.getEllipseById(ellipseId);
    expect(ellipse).not.toBeNull();
    expect(ellipse!.linkDimensions).toBe(true);
  });

  it('sets RY = RX when linking an ellipse', async () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    await actionsManager.execute('toggle-link-dimensions');

    const ellipse = geometryStore.getEllipseById(ellipseId);
    expect(ellipse).not.toBeNull();
    expect(ellipse!.linkDimensions).toBe(true);
    expect(ellipse!.radiusX).toBe(10);
    expect(ellipse!.radiusY).toBe(10);
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('toggle-link-dimensions');
    expect(action.disabled).toBe(true);
  });

  it('is disabled when a polygon is selected', () => {
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

    const action = actionsManager.getAction('toggle-link-dimensions');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when exactly one rectangle is selected', () => {
    const rectId = historyManager.generateStableId(ID_PREFIXES.rectangle);
    geometryStore.addRectangleDirect({
      id: rectId,
      upperLeft: new SheetPosition(0, 0),
      lowerRight: new SheetPosition(10, 20),
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(rectId);

    const action = actionsManager.getAction('toggle-link-dimensions');
    expect(action.disabled).toBe(false);
  });

  it('is enabled when exactly one ellipse is selected', () => {
    const ellipseId = historyManager.generateStableId(ID_PREFIXES.ellipse);
    geometryStore.addEllipseDirect({
      id: ellipseId,
      center: new SheetPosition(0, 0),
      radiusX: 10,
      radiusY: 20,
      fillColor: null,
      linkDimensions: false,
      renderOrder: 0,
    });
    selectionManager.select(ellipseId);

    const action = actionsManager.getAction('toggle-link-dimensions');
    expect(action.disabled).toBe(false);
  });
});
