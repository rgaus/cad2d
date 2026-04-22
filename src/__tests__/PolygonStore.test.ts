import { PolygonStore } from '../lib/tools/PolygonStore';
import { HistoryManager } from '../lib/history/HistoryManager';
import { SheetPosition } from '../lib/viewport/types';
import type { PointSegment, Polygon } from '../lib/tools/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

describe('PolygonStore', () => {
  let historyManager: HistoryManager;
  let store: PolygonStore;

  beforeEach(() => {
    historyManager = new HistoryManager();
    store = new PolygonStore(historyManager);
    historyManager.setPolygonStore(store);
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
});
