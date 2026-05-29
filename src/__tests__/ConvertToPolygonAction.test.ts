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
    actionsManager = new ActionsManager(Sheet.a4(), geometryStore, selectionManager, historyManager);
    actionsManager.setToolManager(toolManager);
  });

  it('converts a rectangle to a polygon', async () => {
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

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.polygons.length).toBe(1);
  });

  it('converts an ellipse to a polygon', async () => {
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

    await actionsManager.execute('convert-to-polygon');

    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.polygons.length).toBe(1);
  });

  it('updates selection to the new polygon', async () => {
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

    await actionsManager.execute('convert-to-polygon');

    const selectedIds = selectionManager.getSelectedIds();
    expect(selectedIds).toHaveLength(1);
    expect(selectedIds[0]).not.toBe(rectId);
    expect(geometryStore.getPolygonById(selectedIds[0])).not.toBeNull();
  });

  it('supports undo/redo for rectangle conversion', async () => {
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

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.polygons[0].id;
    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getRectangleById(rectId)).not.toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getRectangleById(rectId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();
  });

  it('supports undo/redo for ellipse conversion', async () => {
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

    await actionsManager.execute('convert-to-polygon');
    const polygonId = geometryStore.polygons[0].id;
    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();

    historyManager.undo();
    expect(geometryStore.getEllipseById(ellipseId)).not.toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).toBeNull();

    historyManager.redo();
    expect(geometryStore.getEllipseById(ellipseId)).toBeNull();
    expect(geometryStore.getPolygonById(polygonId)).not.toBeNull();
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('convert-to-polygon');
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

    const action = actionsManager.getAction('convert-to-polygon');
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

    const action = actionsManager.getAction('convert-to-polygon');
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

    const action = actionsManager.getAction('convert-to-polygon');
    expect(action.disabled).toBe(false);
  });
});
