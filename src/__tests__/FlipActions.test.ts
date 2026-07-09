import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  Ellipse,
  EllipseComponent,
  Polygon,
  PolygonComponent,
  type PolygonSegment,
  Rectangle,
  RectangleComponent,
} from '@/lib/geometry';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

describe('FlipHorizontalAction', () => {
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

  it('has the correct type', () => {
    const action = actionsManager.getAction('flip-horizontal');
    expect(action.type).toBe('flip-horizontal');
  });

  it('has the correct label', () => {
    const action = actionsManager.getAction('flip-horizontal');
    expect(action.label).toBe('Flip Horizontal');
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('flip-horizontal');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when a shape is selected', () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('flip-horizontal');
    expect(action.disabled).toBe(false);
  });

  it('flips a polygon horizontally around its bounding box center', async () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('flip-horizontal');

    const geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(geometry).not.toBeNull();
    const polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.x).toBeCloseTo(10);
    expect(polygon.points[0].point.y).toBeCloseTo(0);
    expect(polygon.points[1].point.x).toBeCloseTo(0);
    expect(polygon.points[1].point.y).toBeCloseTo(0);
    expect(polygon.points[2].point.x).toBeCloseTo(0);
    expect(polygon.points[2].point.y).toBeCloseTo(10);
    expect(polygon.points[3].point.x).toBeCloseTo(10);
    expect(polygon.points[3].point.y).toBeCloseTo(0);
  });

  it('flips a rectangle horizontally', async () => {
    const { id: rectId } = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(2, 4), new SheetPosition(10, 12)),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('flip-horizontal');

    const geometry = geometryStore.getByIdWithComponent(rectId, RectangleComponent);
    expect(geometry).not.toBeNull();
    const rect = RectangleComponent.get(geometry!);
    expect(rect.upperLeft.x).toBeCloseTo(2);
    expect(rect.upperLeft.y).toBeCloseTo(4);
    expect(rect.lowerRight.x).toBeCloseTo(10);
    expect(rect.lowerRight.y).toBeCloseTo(12);
  });

  it('flips an ellipse horizontally', async () => {
    const { id: ellipseId } = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(5, 5), { radiusX: 3, radiusY: 2 }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('flip-horizontal');

    const geometry = geometryStore.getByIdWithComponent(ellipseId, EllipseComponent);
    expect(geometry).not.toBeNull();
    const ellipse = EllipseComponent.get(geometry!);
    expect(ellipse.center.x).toBeCloseTo(5);
    expect(ellipse.center.y).toBeCloseTo(5);
    expect(ellipse.radiusX).toBe(3);
    expect(ellipse.radiusY).toBe(2);
  });

  it('flips multiple shapes as a group around the collective bounding box center', async () => {
    const { id: poly1Id } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(4, 0) },
        { type: 'point' as const, point: new SheetPosition(4, 4) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    const { id: poly2Id } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(12, 0) },
        { type: 'point' as const, point: new SheetPosition(16, 0) },
        { type: 'point' as const, point: new SheetPosition(16, 4) },
        { type: 'point' as const, point: new SheetPosition(12, 0) },
      ]),
    );

    selectionManager.select(poly1Id);
    selectionManager.select(poly2Id);

    await actionsManager.execute('flip-horizontal');

    const poly1Geom = geometryStore.getByIdWithComponent(poly1Id, PolygonComponent);
    const poly2Geom = geometryStore.getByIdWithComponent(poly2Id, PolygonComponent);
    expect(poly1Geom).not.toBeNull();
    expect(poly2Geom).not.toBeNull();

    const poly1Data = PolygonComponent.get(poly1Geom!);
    const poly2Data = PolygonComponent.get(poly2Geom!);

    expect(poly1Data.points[0].point.x).toBeCloseTo(16);
    expect(poly1Data.points[0].point.y).toBeCloseTo(0);
    expect(poly2Data.points[0].point.x).toBeCloseTo(4);
    expect(poly2Data.points[0].point.y).toBeCloseTo(0);
  });

  it('undo restores original positions after flip', async () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('flip-horizontal');

    let geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    let polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.x).toBeCloseTo(10);

    historyManager.undo();

    geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.x).toBeCloseTo(0);
    expect(polygon.points[0].point.y).toBeCloseTo(0);
    expect(polygon.points[1].point.x).toBeCloseTo(10);
    expect(polygon.points[1].point.y).toBeCloseTo(0);
    expect(polygon.points[2].point.x).toBeCloseTo(10);
    expect(polygon.points[2].point.y).toBeCloseTo(10);
    expect(polygon.points[3].point.x).toBeCloseTo(0);
    expect(polygon.points[3].point.y).toBeCloseTo(0);
  });
});

describe('FlipVerticalAction', () => {
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

  it('has the correct type', () => {
    const action = actionsManager.getAction('flip-vertical');
    expect(action.type).toBe('flip-vertical');
  });

  it('has the correct label', () => {
    const action = actionsManager.getAction('flip-vertical');
    expect(action.label).toBe('Flip Vertical');
  });

  it('is disabled when nothing is selected', () => {
    const action = actionsManager.getAction('flip-vertical');
    expect(action.disabled).toBe(true);
  });

  it('is enabled when a shape is selected', () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    const action = actionsManager.getAction('flip-vertical');
    expect(action.disabled).toBe(false);
  });

  it('flips a polygon vertically around its bounding box center', async () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('flip-vertical');

    const geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    expect(geometry).not.toBeNull();
    const polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.x).toBeCloseTo(0);
    expect(polygon.points[0].point.y).toBeCloseTo(10);
    expect(polygon.points[1].point.x).toBeCloseTo(10);
    expect(polygon.points[1].point.y).toBeCloseTo(10);
    expect(polygon.points[2].point.x).toBeCloseTo(10);
    expect(polygon.points[2].point.y).toBeCloseTo(0);
    expect(polygon.points[3].point.x).toBeCloseTo(0);
    expect(polygon.points[3].point.y).toBeCloseTo(10);
  });

  it('flips a rectangle vertically', async () => {
    const { id: rectId } = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(2, 4), new SheetPosition(10, 12)),
    );
    selectionManager.select(rectId);

    await actionsManager.execute('flip-vertical');

    const geometry = geometryStore.getByIdWithComponent(rectId, RectangleComponent);
    expect(geometry).not.toBeNull();
    const rect = RectangleComponent.get(geometry!);
    expect(rect.upperLeft.x).toBeCloseTo(2);
    expect(rect.upperLeft.y).toBeCloseTo(4);
    expect(rect.lowerRight.x).toBeCloseTo(10);
    expect(rect.lowerRight.y).toBeCloseTo(12);
  });

  it('flips an ellipse vertically', async () => {
    const { id: ellipseId } = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(5, 5), { radiusX: 3, radiusY: 2 }),
    );
    selectionManager.select(ellipseId);

    await actionsManager.execute('flip-vertical');

    const geometry = geometryStore.getByIdWithComponent(ellipseId, EllipseComponent);
    expect(geometry).not.toBeNull();
    const ellipse = EllipseComponent.get(geometry!);
    expect(ellipse.center.x).toBeCloseTo(5);
    expect(ellipse.center.y).toBeCloseTo(5);
    expect(ellipse.radiusX).toBe(3);
    expect(ellipse.radiusY).toBe(2);
  });

  it('flips multiple shapes as a group around the collective bounding box center', async () => {
    const { id: poly1Id } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(4, 0) },
        { type: 'point' as const, point: new SheetPosition(4, 4) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    const { id: poly2Id } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 12) },
        { type: 'point' as const, point: new SheetPosition(4, 12) },
        { type: 'point' as const, point: new SheetPosition(4, 16) },
        { type: 'point' as const, point: new SheetPosition(0, 12) },
      ]),
    );

    selectionManager.select(poly1Id);
    selectionManager.select(poly2Id);

    await actionsManager.execute('flip-vertical');

    const poly1Geom = geometryStore.getByIdWithComponent(poly1Id, PolygonComponent);
    const poly2Geom = geometryStore.getByIdWithComponent(poly2Id, PolygonComponent);
    expect(poly1Geom).not.toBeNull();
    expect(poly2Geom).not.toBeNull();

    const poly1Data = PolygonComponent.get(poly1Geom!);
    const poly2Data = PolygonComponent.get(poly2Geom!);

    expect(poly1Data.points[0].point.x).toBeCloseTo(0);
    expect(poly1Data.points[0].point.y).toBeCloseTo(16);
    expect(poly2Data.points[0].point.x).toBeCloseTo(0);
    expect(poly2Data.points[0].point.y).toBeCloseTo(4);
  });

  it('undo restores original positions after flip', async () => {
    const { id: polygonId } = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([
        { type: 'point' as const, point: new SheetPosition(0, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 0) },
        { type: 'point' as const, point: new SheetPosition(10, 10) },
        { type: 'point' as const, point: new SheetPosition(0, 0) },
      ]),
    );
    selectionManager.select(polygonId);

    await actionsManager.execute('flip-vertical');

    let geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    let polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.y).toBeCloseTo(10);

    historyManager.undo();

    geometry = geometryStore.getByIdWithComponent(polygonId, PolygonComponent);
    polygon = PolygonComponent.get(geometry!);
    expect(polygon.points[0].point.x).toBeCloseTo(0);
    expect(polygon.points[0].point.y).toBeCloseTo(0);
    expect(polygon.points[1].point.x).toBeCloseTo(10);
    expect(polygon.points[1].point.y).toBeCloseTo(0);
    expect(polygon.points[2].point.x).toBeCloseTo(10);
    expect(polygon.points[2].point.y).toBeCloseTo(10);
    expect(polygon.points[3].point.x).toBeCloseTo(0);
    expect(polygon.points[3].point.y).toBeCloseTo(0);
  });
});
