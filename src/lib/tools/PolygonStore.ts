import EventEmitter from 'eventemitter3';
import { HistoryManager } from '../history/HistoryManager';
import type { Id } from './types';
import type { Polygon, WorkingPolygon } from './types';

/** Events emitted by PolygonStore. */
export type PolygonStoreEvents = {
  polygonAdded: (polygon: Polygon) => void;
  polygonsChanged: (polygons: Array<Polygon>) => void;
  workingPolygonChanged: (wp: WorkingPolygon | null) => void;
};

/**
 * Stores all completed polygons and the currently-drawn working polygon.
 * All mutating operations are recorded to the HistoryManager for undo/redo.
 */
export class PolygonStore extends EventEmitter<PolygonStoreEvents> {
  polygons: Array<Polygon> = [];
  workingPolygon: WorkingPolygon | null = null;
  private readonly historyManager: HistoryManager;

  constructor(historyManager: HistoryManager) {
    super();
    this.historyManager = historyManager;
  }

  /**
   * Adds a polygon, assigning it a stable UUID as its id.
   * Records the insertion to history for undo/redo.
   */
  addPolygon(polygon: Omit<Polygon, 'id'>): Polygon {
    const id = this.historyManager.generateStableId();
    const fullPolygon: Polygon = { ...polygon, id };
    this.polygons.push(fullPolygon);
    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', fullPolygon);
    return fullPolygon;
  }

  /**
   * Internal version of addPolygon that uses an existing polygon with its own id.
   * Does NOT record to history. Used by HistoryManager redo.
   */
  addPolygonDirect(polygon: Polygon): void {
    this.polygons.push(polygon);
    this.emit('polygonsChanged', this.polygons);
    this.emit('polygonAdded', polygon);
  }

  /** Updates a polygon by id, recording the change to history. */
  updatePolygon(id: Id, updates: Partial<Polygon>): void {
    const idx = this.polygons.findIndex(p => p.id === id);
    if (idx !== -1) {
      const beforeSegments = this.polygons[idx].points;
      this.polygons[idx] = { ...this.polygons[idx], ...updates };
      if (updates.points && updates.points !== beforeSegments) {
        this.historyManager.recordMove(id, beforeSegments, updates.points);
      }
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /** Deletes a polygon by id, recording the deletion to history. */
  deletePolygon(id: Id): void {
    const polygon = this.polygons.find(p => p.id === id);
    if (polygon) {
      this.polygons = this.polygons.filter(p => p.id !== id);
      this.historyManager.recordDelete(polygon);
      this.emit('polygonsChanged', this.polygons);
    }
  }

  /**
   * Internal version of deletePolygon that does NOT record to history.
   * Used by HistoryManager undo.
   */
  deletePolygonDirect(id: Id): void {
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

  /** Clears all polygons, recording each deletion to history. */
  clearAllPolygons(): void {
    for (const polygon of this.polygons) {
      this.historyManager.recordDelete(polygon);
    }
    this.polygons = [];
    this.emit('polygonsChanged', this.polygons);
  }
}
