import EventEmitter from 'eventemitter3';
import { PolygonStore } from '../tools/PolygonStore';
import type { Id } from '../tools/types';
import type {
  UndoEntry,
  PolygonInsertEntry,
  PolygonMoveEntry,
  PolygonMoveVertexEntry,
  PolygonMoveControlPointEntry,
  PolygonDeleteEntry,
} from './types';
import type { Polygon, PolygonSegment } from '../tools/types';
import type { SheetPosition } from '../viewport/types';

/** Events emitted by HistoryManager. */
export type HistoryManagerEvents = {
  stacksChange: () => void;
};

/**
 * Manages undo/redo stacks for polygon operations.
 * Generates stable IDs for new polygons and applies/reverts operations.
 */
export class HistoryManager extends EventEmitter<HistoryManagerEvents> {
  private undoStack: Array<UndoEntry> = [];
  private redoStack: Array<UndoEntry> = [];
  private polygonStore: PolygonStore | null = null;

  constructor(polygonStore?: PolygonStore) {
    super();
    if (polygonStore) {
      this.polygonStore = polygonStore;
    }
  }

  /** Sets the PolygonStore. Safe to call after construction if not provided to constructor. */
  setPolygonStore(polygonStore: PolygonStore): void {
    this.polygonStore = polygonStore;
  }

  /** Generates a stable UUID for a new polygon. Called before addPolygon. */
  generateStableId(): Id {
    return crypto.randomUUID();
  }

  /** Returns true if there are entries on the undo stack. */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Returns true if there are entries on the redo stack. */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Undoes the most recent operation, pushing it onto the redo stack. */
  undo(): void {
    const entry = this.undoStack.pop();
    if (entry === undefined) return;

    this.applyReverse(entry);
    this.redoStack.push(entry);
    this.emit('stacksChange');
  }

  /** Redoes the most recently undone operation, pushing it back onto the undo stack. */
  redo(): void {
    const entry = this.redoStack.pop();
    if (entry === undefined) return;

    this.applyForward(entry);
    this.undoStack.push(entry);
    this.emit('stacksChange');
  }

  /** Returns a copy of the current undo stack. */
  getUndoStack(): Array<UndoEntry> {
    return [...this.undoStack];
  }

  /** Returns a copy of the current redo stack. */
  getRedoStack(): Array<UndoEntry> {
    return [...this.redoStack];
  }

  /** Records an insert operation and pushes it onto the undo stack. */
  recordInsert(polygon: Polygon): void {
    const entry: PolygonInsertEntry = { type: 'polygon-insert', polygon };
    this.push(entry);
  }

  /** Records a move operation (all vertices shifted) and pushes it onto the undo stack. */
  recordMove(id: Id, beforeSegments: Array<PolygonSegment>, afterSegments: Array<PolygonSegment>): void {
    const entry: PolygonMoveEntry = {
      type: 'polygon-move',
      id,
      beforeSegments,
      afterSegments,
    };
    this.push(entry);
  }

  /** Records a vertex move and pushes it onto the undo stack. */
  recordMoveVertex(
    id: Id,
    segmentIndex: number,
    beforePoint: SheetPosition,
    afterPoint: SheetPosition,
  ): void {
    const entry: PolygonMoveVertexEntry = {
      type: 'polygon-move-vertex',
      id,
      segmentIndex,
      beforePoint,
      afterPoint,
    };
    this.push(entry);
  }

  /** Records a control point move and pushes it onto the undo stack. */
  recordMoveControlPoint(
    id: Id,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
    beforePoint: SheetPosition,
    afterPoint: SheetPosition,
  ): void {
    const entry: PolygonMoveControlPointEntry = {
      type: 'polygon-move-control-point',
      id,
      segmentIndex,
      pointKey,
      beforePoint,
      afterPoint,
    };
    this.push(entry);
  }

  /** Records a delete operation and pushes it onto the undo stack. */
  recordDelete(polygon: Polygon): void {
    const entry: PolygonDeleteEntry = { type: 'polygon-delete', polygon };
    this.push(entry);
  }

  /** Pushes an entry onto the undo stack and clears the redo stack. */
  private push(entry: UndoEntry): void {
    this.undoStack.push(entry);
    this.redoStack = [];
    this.emit('stacksChange');
  }

  /** Applies the forward (redo) side of an entry. */
  private applyForward(entry: UndoEntry): void {
    if (!this.polygonStore) return;
    switch (entry.type) {
      case 'polygon-insert':
        this.polygonStore.addPolygonDirect(entry.polygon);
        break;
      case 'polygon-delete':
        this.polygonStore.deletePolygonDirect(entry.polygon.id);
        break;
      case 'polygon-move':
        this.polygonStore.updatePolygon(entry.id, { points: entry.afterSegments });
        break;
      case 'polygon-move-vertex': {
        const polygon = this.polygonStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.afterPoint,
          };
          this.polygonStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.polygonStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.afterPoint };
          this.polygonStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
    }
  }

  /** Applies the reverse (undo) side of an entry. */
  private applyReverse(entry: UndoEntry): void {
    if (!this.polygonStore) return;
    switch (entry.type) {
      case 'polygon-insert':
        this.polygonStore.deletePolygonDirect(entry.polygon.id);
        break;
      case 'polygon-delete':
        this.polygonStore.addPolygonDirect(entry.polygon);
        break;
      case 'polygon-move':
        this.polygonStore.updatePolygon(entry.id, { points: entry.beforeSegments });
        break;
      case 'polygon-move-vertex': {
        const polygon = this.polygonStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.beforePoint,
          };
          this.polygonStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.polygonStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.beforePoint };
          this.polygonStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
    }
  }
}
