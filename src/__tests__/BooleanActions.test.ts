import { ActionsManager } from '@/lib/actions/ActionsManager';
import { computeBooleanOperation } from '@/lib/actions/boolean-compute';
import { extractGeometry } from '@/lib/actions/boolean-utils';
import { GeometryStore, ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { SheetPosition } from '@/lib/viewport/types';

describe('computeBooleanOperation', () => {
  it('computes union of two overlapping squares', () => {
    const result = computeBooleanOperation('union', [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [5, 0],
        [15, 0],
        [15, 10],
        [5, 10],
      ],
    ]);
    expect(result).not.toBeNull();
    // Union should be (0,0) to (15,10) - 4 corners + closing duplicate
    const xCoords = result!.map((p) => p[0]);
    const yCoords = result!.map((p) => p[1]);
    expect(Math.min(...xCoords)).toBeCloseTo(0);
    expect(Math.max(...xCoords)).toBeCloseTo(15);
    expect(Math.min(...yCoords)).toBeCloseTo(0);
    expect(Math.max(...yCoords)).toBeCloseTo(10);
  });

  it('computes difference of two overlapping squares', () => {
    const result = computeBooleanOperation('difference', [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [5, 0],
        [15, 0],
        [15, 10],
        [5, 10],
      ],
    ]);
    expect(result).not.toBeNull();
    // Difference should be (0,0) to (5,10) - the left portion
    const xCoords = result!.map((p) => p[0]);
    expect(Math.min(...xCoords)).toBeCloseTo(0);
    expect(Math.max(...xCoords)).toBeCloseTo(5);
  });

  it('computes intersection of two overlapping squares', () => {
    const result = computeBooleanOperation('intersection', [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [5, 0],
        [15, 0],
        [15, 10],
        [5, 10],
      ],
    ]);
    expect(result).not.toBeNull();
    // Intersection should be (5,0) to (10,10) - the overlapping region
    const xCoords = result!.map((p) => p[0]);
    const yCoords = result!.map((p) => p[1]);
    expect(Math.min(...xCoords)).toBeCloseTo(5);
    expect(Math.max(...xCoords)).toBeCloseTo(10);
    expect(Math.min(...yCoords)).toBeCloseTo(0);
    expect(Math.max(...yCoords)).toBeCloseTo(10);
  });
});

describe('extractGeometry', () => {
  let geometryStore: GeometryStore;
  let historyManager: HistoryManager;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  it('extracts polygon points from selected geometries', () => {
    const id1 = historyManager.generateStableId(ID_PREFIXES.polygon);
    const id2 = historyManager.generateStableId(ID_PREFIXES.polygon);

    geometryStore.addPolygonDirect({
      id: id1,
      closed: true,
      points: [
        { type: 'point', point: new SheetPosition(0, 0) },
        { type: 'point', point: new SheetPosition(10, 0) },
        { type: 'point', point: new SheetPosition(10, 10) },
        { type: 'point', point: new SheetPosition(0, 10) },
        { type: 'point', point: new SheetPosition(0, 0) },
      ],
      fillColor: 0xff0000,
      openAtIndex: 0,
      renderOrder: 0,
    });

    geometryStore.addPolygonDirect({
      id: id2,
      closed: true,
      points: [
        { type: 'point', point: new SheetPosition(5, 0) },
        { type: 'point', point: new SheetPosition(15, 0) },
        { type: 'point', point: new SheetPosition(15, 10) },
        { type: 'point', point: new SheetPosition(5, 10) },
        { type: 'point', point: new SheetPosition(5, 0) },
      ],
      fillColor: 0x00ff00,
      openAtIndex: 0,
      renderOrder: 0,
    });

    const result = extractGeometry(geometryStore, [id1, id2]);
    expect(result.polygons).toHaveLength(2);
    expect(result.firstFillColor).toBe(0xff0000);
    expect(result.polygons[0]).toContainEqual([0, 0]);
    expect(result.polygons[1]).toContainEqual([5, 0]);
  });
});

describe('BooleanActions', () => {
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

  describe('UnionAction', () => {
    it('unions two overlapping rectangles into a combined polygon', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected union: (0,0) to (15,10)
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.rectangles.push({
        id: rect1Id,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: 0x0000ff,
        linkDimensions: false,
        renderOrder: 0,
      });

      geometryStore.rectangles.push({
        id: rect2Id,
        upperLeft: new SheetPosition(5, 0),
        lowerRight: new SheetPosition(15, 10),
        fillColor: 0x00ff00,
        linkDimensions: false,
        renderOrder: 0,
      });

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('union');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should have 4 unique corners (closed polygon has 5 points - first/last same)
      expect(resultPolygon.points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(resultPolygon.points[0].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[4].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(resultPolygon.points[0].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[1].point.x).toBeCloseTo(15);
      expect(resultPolygon.points[1].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[2].point.x).toBeCloseTo(15);
      expect(resultPolygon.points[2].point.y).toBeCloseTo(10);
      expect(resultPolygon.points[3].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(resultPolygon.fillColor).toBe(0x0000ff);
    });
  });

  describe('DifferenceAction', () => {
    it('subtracts second rectangle from first rectangle', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected difference: (0,0) to (5,10) - the left portion that remains
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.rectangles.push({
        id: rect1Id,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: 0x0000ff,
        linkDimensions: false,
        renderOrder: 0,
      });

      geometryStore.rectangles.push({
        id: rect2Id,
        upperLeft: new SheetPosition(5, 0),
        lowerRight: new SheetPosition(15, 10),
        fillColor: 0x00ff00,
        linkDimensions: false,
        renderOrder: 0,
      });

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('difference');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should be the remaining left portion (0,0), (5,0), (5,10), (0,10) - closed has 5 points
      expect(resultPolygon.points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(resultPolygon.points[0].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[4].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(resultPolygon.points[0].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[1].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[1].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[2].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[2].point.y).toBeCloseTo(10);
      expect(resultPolygon.points[3].point.x).toBeCloseTo(0);
      expect(resultPolygon.points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(resultPolygon.fillColor).toBe(0x0000ff);
    });
  });

  describe('IntersectionAction', () => {
    it('intersects two overlapping rectangles into the overlapping region', async () => {
      // Create two rectangles that overlap
      // Rect 1: (0,0) to (10,10)
      // Rect 2: (5,0) to (15,10)
      // Expected intersection: (5,0) to (10,10) - the overlapping region
      const rect1Id = historyManager.generateStableId(ID_PREFIXES.rectangle);
      const rect2Id = historyManager.generateStableId(ID_PREFIXES.rectangle);

      geometryStore.rectangles.push({
        id: rect1Id,
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
        fillColor: 0x0000ff,
        linkDimensions: false,
        renderOrder: 0,
      });

      geometryStore.rectangles.push({
        id: rect2Id,
        upperLeft: new SheetPosition(5, 0),
        lowerRight: new SheetPosition(15, 10),
        fillColor: 0x00ff00,
        linkDimensions: false,
        renderOrder: 0,
      });

      selectionManager.select(rect1Id);
      selectionManager.select(rect2Id);

      await actionsManager.execute('intersection');

      // Should have created a new polygon
      expect(geometryStore.polygons.length).toBe(1);
      const resultPolygon = geometryStore.polygons[0];

      // Polygon should be the overlapping region (5,0), (10,0), (10,10), (5,10) - closed has 5 points
      expect(resultPolygon.points).toHaveLength(5);
      // First point equals last point (closed polygon)
      expect(resultPolygon.points[0].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[4].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[4].point.y).toBeCloseTo(0);
      // The 4 unique corners in order
      expect(resultPolygon.points[0].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[0].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[1].point.x).toBeCloseTo(10);
      expect(resultPolygon.points[1].point.y).toBeCloseTo(0);
      expect(resultPolygon.points[2].point.x).toBeCloseTo(10);
      expect(resultPolygon.points[2].point.y).toBeCloseTo(10);
      expect(resultPolygon.points[3].point.x).toBeCloseTo(5);
      expect(resultPolygon.points[3].point.y).toBeCloseTo(10);

      // Result should have first polygon's color (blue)
      expect(resultPolygon.fillColor).toBe(0x0000ff);
    });
  });
});
