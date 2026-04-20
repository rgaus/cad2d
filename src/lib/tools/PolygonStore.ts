import EventEmitter from 'eventemitter3';
import type { Polygon, WorkingPolygon } from './types';

export type PolygonStoreEvents = {
  polygonAdded: (polygon: Polygon) => void;
  polygonsChanged: (polygons: Array<Polygon>) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
};

export class PolygonStore extends EventEmitter<PolygonStoreEvents> {
  polygons: Array<Polygon> = [];
  workingPolygon: WorkingPolygon | null = null;

  addPolygon(polygon: Polygon): void {
    this.polygons.push(polygon);
    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', polygon);
  }

  updatePolygon(id: string, updates: Partial<Polygon>): void {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx !== -1) {
      this.polygons[idx] = { ...this.polygons[idx], ...updates };
      this.emit('polygonsChanged', this.polygons);
    }
  }

  deletePolygon(id: string): void {
    this.polygons = this.polygons.filter(p => p.id !== id);
    this.emit('polygonsChanged', this.polygons);
  }

  setWorkingPolygon(wp: WorkingPolygon | null): void {
    this.workingPolygon = wp;
    this.emit('workingPolygonChanged', wp);
  }

  clearWorkingPolygon(): void {
    this.workingPolygon = null;
    this.emit('workingPolygonChanged', null);
  }

  clearAllPolygons(): void {
    this.polygons = [];
    this.emit('polygonsChanged', this.polygons);
  }
}