import { GeometryStore } from '../lib/tools/GeometryStore';
import { HistoryManager } from '../lib/history/HistoryManager';
import { SheetPosition } from '../lib/viewport/types';
import type { PointSegment, Polygon } from '../lib/tools/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

describe('GeometryStore', () => {
  let historyManager: HistoryManager;
  let store: GeometryStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    store = new GeometryStore(historyManager);
    historyManager.setGeometryStore(store);
  });

  describe('addPolygon', () => {
    it('adds polygon to array', () => {
      const polygon = store.addPolygon({ points: [makePoint(0, 0)], closed: true });
      expect(store.polygons).toHaveLength(1);
      expect(store.polygons[0].id).toBe(polygon.id);
      expect(store.polygons[0].points).toEqual([makePoint(0, 0)]);
    });

    it('generates a stable id for new polygons', () => {
      const polygon1 = store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      const polygon2 = store.addPolygon({ points: [makePoint(1, 1)], closed: false });
      expect(polygon1.id).not.toBe(polygon2.id);
      expect(typeof polygon1.id).toBe('string');
      expect(polygon1.id.length).toBeGreaterThan(0);
    });

    it('emits polygonAdded event', () => {
      const spy = jest.fn();
      store.on('polygonAdded', spy);
      const polygon = store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      expect(spy).toHaveBeenCalledWith(polygon);
    });

    it('emits polygonsChanged event', () => {
      const spy = jest.fn();
      store.on('polygonsChanged', spy);
      store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      expect(spy).toHaveBeenCalledWith(store.polygons);
    });
  });

  describe('updatePolygon', () => {
    it('updates existing polygon', () => {
      store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      const id = store.polygons[0].id;
      store.updatePolygon(id, { closed: true });
      expect(store.polygons[0].closed).toBe(true);
    });

    it('does nothing for non-existent id', () => {
      store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      store.updatePolygon('nonexistent' as any, { closed: true });
      expect(store.polygons[0].closed).toBe(false);
    });
  });

  describe('deletePolygon', () => {
    it('removes polygon by id', () => {
      const polygon = store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      store.addPolygon({ points: [makePoint(1, 1)], closed: false });
      store.deletePolygon(polygon.id);
      expect(store.polygons).toHaveLength(1);
    });
  });

  describe('workingPolygon', () => {
    it('setWorkingPolygon sets working polygon', () => {
      const wp = { points: [makePoint(0, 0)], previewPoint: null, pendingArcEndPoint: null };
      store.setWorkingPolygon(wp);
      expect(store.workingPolygon).toEqual(wp);
    });

    it('clearWorkingPolygon clears working polygon', () => {
      store.setWorkingPolygon({ points: [makePoint(0, 0)], previewPoint: null, pendingArcEndPoint: null });
      store.clearWorkingPolygon();
      expect(store.workingPolygon).toBeNull();
    });

    it('emits workingPolygonChanged on setWorkingPolygon', () => {
      const wp = { points: [makePoint(0, 0)], previewPoint: null, pendingArcEndPoint: null };
      const spy = jest.fn();
      store.on('workingPolygonChanged', spy);
      store.setWorkingPolygon(wp);
      expect(spy).toHaveBeenCalledWith(wp);
    });

    it('emits workingPolygonChanged on clearWorkingPolygon', () => {
      store.setWorkingPolygon({ points: [makePoint(0, 0)], previewPoint: null, pendingArcEndPoint: null });
      const spy = jest.fn();
      store.on('workingPolygonChanged', spy);
      store.clearWorkingPolygon();
      expect(spy).toHaveBeenCalledWith(null);
    });
  });

  describe('clearAllPolygons', () => {
    it('removes all polygons', () => {
      store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      store.addPolygon({ points: [makePoint(1, 1)], closed: false });
      store.clearAllPolygons();
      expect(store.polygons).toHaveLength(0);
    });

    it('emits polygonsChanged', () => {
      store.addPolygon({ points: [makePoint(0, 0)], closed: false });
      const spy = jest.fn();
      store.on('polygonsChanged', spy);
      store.clearAllPolygons();
      expect(spy).toHaveBeenCalledWith([]);
    });
  });

  describe('addRectangle', () => {
    it('adds rectangle to array', () => {
      const rectangle = store.addRectangle({
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
      });
      expect(store.rectangles).toHaveLength(1);
      expect(store.rectangles[0].id).toBe(rectangle.id);
      expect(store.rectangles[0].upperLeft).toEqual(new SheetPosition(0, 0));
      expect(store.rectangles[0].lowerRight).toEqual(new SheetPosition(10, 10));
    });

    it('generates a stable id for new rectangles', () => {
      const rect1 = store.addRectangle({
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
      });
      const rect2 = store.addRectangle({
        upperLeft: new SheetPosition(1, 1),
        lowerRight: new SheetPosition(11, 11),
      });
      expect(rect1.id).not.toBe(rect2.id);
    });

    it('emits rectangleAdded event', () => {
      const spy = jest.fn();
      store.on('rectangleAdded', spy);
      store.addRectangle({
        upperLeft: new SheetPosition(0, 0),
        lowerRight: new SheetPosition(10, 10),
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('addEllipse', () => {
    it('adds ellipse to array', () => {
      const ellipse = store.addEllipse({
        center: new SheetPosition(5, 5),
        radiusX: 5,
        radiusY: 3,
      });
      expect(store.ellipses).toHaveLength(1);
      expect(store.ellipses[0].id).toBe(ellipse.id);
      expect(store.ellipses[0].center).toEqual(new SheetPosition(5, 5));
      expect(store.ellipses[0].radiusX).toBe(5);
      expect(store.ellipses[0].radiusY).toBe(3);
    });

    it('generates a stable id for new ellipses', () => {
      const ellipse1 = store.addEllipse({
        center: new SheetPosition(5, 5),
        radiusX: 5,
        radiusY: 3,
      });
      const ellipse2 = store.addEllipse({
        center: new SheetPosition(10, 10),
        radiusX: 5,
        radiusY: 3,
      });
      expect(ellipse1.id).not.toBe(ellipse2.id);
    });
  });

  describe('workingRectangle', () => {
    it('setWorkingRectangle sets working rectangle', () => {
      const wr = {
        firstPoint: new SheetPosition(0, 0),
        previewLowerRight: new SheetPosition(10, 10),
        isCenterMode: false,
      };
      store.setWorkingRectangle(wr);
      expect(store.workingRectangle).toEqual(wr);
    });

    it('clearWorkingRectangle clears working rectangle', () => {
      store.setWorkingRectangle({
        firstPoint: new SheetPosition(0, 0),
        previewLowerRight: new SheetPosition(10, 10),
        isCenterMode: false,
      });
      store.clearWorkingRectangle();
      expect(store.workingRectangle).toBeNull();
    });
  });

  describe('workingEllipse', () => {
    it('setWorkingEllipse sets working ellipse', () => {
      const we = {
        firstPoint: new SheetPosition(5, 5),
        previewPoint: new SheetPosition(10, 5),
        isCenterMode: false,
      };
      store.setWorkingEllipse(we);
      expect(store.workingEllipse).toEqual(we);
    });

    it('clearWorkingEllipse clears working ellipse', () => {
      store.setWorkingEllipse({
        firstPoint: new SheetPosition(5, 5),
        previewPoint: new SheetPosition(10, 5),
        isCenterMode: false,
      });
      store.clearWorkingEllipse();
      expect(store.workingEllipse).toBeNull();
    });
  });
});
