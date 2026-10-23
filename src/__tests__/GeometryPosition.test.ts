import { Ellipse, GeometryComponent, Polygon, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { GeometryPosition, SheetPosition } from '@/lib/viewport/types';

function makePoint(x: number, y: number) {
  return { type: 'point' as const, point: new SheetPosition(x, y) };
}

describe('GeometryPosition', () => {
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
  });

  function setAnchor(id: string, keyPoint: string, offset: SheetPosition) {
    geometryStore.updateByIdWithComponent(id, AnchorPointComponent, (g) =>
      AnchorPointComponent.update(g, { keyPoint, offset }),
    );
  }

  function getGeometryWithAnchor(id: string) {
    return geometryStore.getByIdWithComponents(id, GeometryComponent, AnchorPointComponent)!;
  }

  it('converts local coordinates to sheet coordinates relative to the natural origin', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17)),
    );
    const geometry = getGeometryWithAnchor(rectangle.id);

    const origin = new GeometryPosition(0, 0).toSheet(geometry);
    expect(origin.x).toBe(11);
    expect(origin.y).toBe(15);

    const lowerRight = new GeometryPosition(5, 2).toSheet(geometry);
    expect(lowerRight.x).toBe(16);
    expect(lowerRight.y).toBe(17);
  });

  it('applies the anchor point offset when converting to sheet coordinates', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17)),
    );
    setAnchor(rectangle.id, 'lowerRight', new SheetPosition(-2, -3));
    const geometry = getGeometryWithAnchor(rectangle.id);

    // rendered = raw - ((lowerRight - upperLeft) + offset) = raw - (3, -1)
    const origin = new GeometryPosition(0, 0).toSheet(geometry);
    expect(origin.x).toBe(8);
    expect(origin.y).toBe(16);

    const lowerRight = new GeometryPosition(5, 2).toSheet(geometry);
    expect(lowerRight.x).toBe(13);
    expect(lowerRight.y).toBe(18);
  });

  it('round-trips sheet positions through geometry coordinates', () => {
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(11, 15), new SheetPosition(16, 17)),
    );
    setAnchor(rectangle.id, 'lowerRight', new SheetPosition(-2, -3));
    const geometry = getGeometryWithAnchor(rectangle.id);

    for (const sheet of [
      new SheetPosition(8, 16),
      new SheetPosition(13, 18),
      new SheetPosition(0, 0),
      new SheetPosition(-4.5, 7.25),
    ]) {
      const roundTripped = sheet.toGeometry(geometry).toSheet(geometry);
      expect(roundTripped.x).toBeCloseTo(sheet.x);
      expect(roundTripped.y).toBeCloseTo(sheet.y);
    }
  });

  it('works for ellipses', () => {
    const ellipse = geometryStore.addOrdered(
      ID_PREFIXES.ellipse,
      Ellipse.create(new SheetPosition(6, 7), { radiusX: 2, radiusY: 4 }),
    );
    setAnchor(ellipse.id, 'center', new SheetPosition(2, 3));
    const geometry = getGeometryWithAnchor(ellipse.id);

    // anchor offset shifts the rendered center by (2, 3)
    const center = new GeometryPosition(0, 0).toSheet(geometry);
    expect(center.x).toBe(4);
    expect(center.y).toBe(4);
  });

  it('works for polygons', () => {
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(2, 3), makePoint(8, 3), makePoint(5, 9)], { closed: true }),
    );
    setAnchor(polygon.id, 'boundingBoxUpperLeft', new SheetPosition(2, 3));
    const geometry = getGeometryWithAnchor(polygon.id);

    // bounding box upper-left is the natural origin; the offset shifts it by (2, 3)
    const origin = new GeometryPosition(0, 0).toSheet(geometry);
    expect(origin.x).toBe(0);
    expect(origin.y).toBe(0);

    const point = new GeometryPosition(6, 0).toSheet(geometry);
    expect(point.x).toBe(6);
    expect(point.y).toBe(0);
  });
});
