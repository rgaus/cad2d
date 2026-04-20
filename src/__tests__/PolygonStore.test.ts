import { PolygonStore } from '../lib/tools/PolygonStore';
import type { Polygon } from '../lib/tools/types';

describe('PolygonStore', () => {
  let store: PolygonStore;

  beforeEach(() => {
    store = new PolygonStore();
  });

  describe('addPolygon', () => {
    it('adds polygon to array', () => {
      const polygon: Polygon = {
        id: '1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
        closed: true,
      };
      store.addPolygon(polygon);
      expect(store.polygons).toHaveLength(1);
      expect(store.polygons[0]).toEqual(polygon);
    });

    it('emits polygonAdded event', () => {
      const polygon: Polygon = {
        id: '1',
        points: [{ x: 0, y: 0 }],
        closed: false,
      };
      const spy = jest.fn();
      store.on('polygonAdded', spy);
      store.addPolygon(polygon);
      expect(spy).toHaveBeenCalledWith(polygon);
    });

    it('emits polygonsChanged event', () => {
      const polygon: Polygon = { id: '1', points: [{ x: 0, y: 0 }], closed: false };
      const spy = jest.fn();
      store.on('polygonsChanged', spy);
      store.addPolygon(polygon);
      expect(spy).toHaveBeenCalledWith(store.polygons);
    });
  });

  describe('updatePolygon', () => {
    it('updates existing polygon', () => {
      store.addPolygon({ id: '1', points: [{ x: 0, y: 0 }], closed: false });
      store.updatePolygon('1', { closed: true });
      expect(store.polygons[0].closed).toBe(true);
    });

    it('does nothing for non-existent id', () => {
      store.addPolygon({ id: '1', points: [{ x: 0, y: 0 }], closed: false });
      store.updatePolygon('999', { closed: true });
      expect(store.polygons[0].closed).toBe(false);
    });
  });

  describe('deletePolygon', () => {
    it('removes polygon by id', () => {
      store.addPolygon({ id: '1', points: [{ x: 0, y: 0 }], closed: false });
      store.addPolygon({ id: '2', points: [{ x: 1, y: 1 }], closed: false });
      store.deletePolygon('1');
      expect(store.polygons).toHaveLength(1);
      expect(store.polygons[0].id).toBe('2');
    });
  });

  describe('workingPolygon', () => {
    it('setWorkingPolygon sets working polygon', () => {
      const wp = { points: [{ x: 0, y: 0 }], previewPoint: null };
      store.setWorkingPolygon(wp);
      expect(store.workingPolygon).toEqual(wp);
    });

    it('clearWorkingPolygon clears working polygon', () => {
      store.setWorkingPolygon({ points: [{ x: 0, y: 0 }], previewPoint: null });
      store.clearWorkingPolygon();
      expect(store.workingPolygon).toBeNull();
    });

    it('emits workingPolygonChanged on setWorkingPolygon', () => {
      const wp = { points: [{ x: 0, y: 0 }], previewPoint: null };
      const spy = jest.fn();
      store.on('workingPolygonChanged', spy);
      store.setWorkingPolygon(wp);
      expect(spy).toHaveBeenCalledWith(wp);
    });

    it('emits workingPolygonChanged on clearWorkingPolygon', () => {
      store.setWorkingPolygon({ points: [{ x: 0, y: 0 }], previewPoint: null });
      const spy = jest.fn();
      store.on('workingPolygonChanged', spy);
      store.clearWorkingPolygon();
      expect(spy).toHaveBeenCalledWith(null);
    });
  });

  describe('clearAllPolygons', () => {
    it('removes all polygons', () => {
      store.addPolygon({ id: '1', points: [{ x: 0, y: 0 }], closed: false });
      store.addPolygon({ id: '2', points: [{ x: 1, y: 1 }], closed: false });
      store.clearAllPolygons();
      expect(store.polygons).toHaveLength(0);
    });

    it('emits polygonsChanged', () => {
      store.addPolygon({ id: '1', points: [{ x: 0, y: 0 }], closed: false });
      const spy = jest.fn();
      store.on('polygonsChanged', spy);
      store.clearAllPolygons();
      expect(spy).toHaveBeenCalledWith([]);
    });
  });
});