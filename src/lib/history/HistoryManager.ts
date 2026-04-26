import EventEmitter from 'eventemitter3';
import { GeometryStore } from '../tools/GeometryStore';
import type { Id } from '../tools/types';
import type {
  UndoEntry,
  PolygonInsertEntry,
  PolygonMoveEntry,
  PolygonMoveVertexEntry,
  PolygonMoveControlPointEntry,
  PolygonDeleteEntry,
  PolygonInsertPointEntry,
  RectangleInsertEntry,
  RectangleMoveEntry,
  RectangleDeleteEntry,
  EllipseInsertEntry,
  EllipseMoveEntry,
  EllipseDeleteEntry,
} from './types';
import type { Polygon, PolygonSegment, Rectangle, Ellipse } from '../tools/types';
import type { SheetPosition } from '../viewport/types';

/** Events emitted by HistoryManager. */
export type HistoryManagerEvents = {
  stacksChange: () => void;
};

/**
 * Manages undo/redo stacks for all geometry operations.
 * Generates stable IDs for new shapes and applies/reverts operations.
 */
export class HistoryManager extends EventEmitter<HistoryManagerEvents> {
  private undoStack: Array<UndoEntry> = [];
  private redoStack: Array<UndoEntry> = [];
  private geometryStore: GeometryStore | null = null;

  constructor(geometryStore?: GeometryStore) {
    super();
    if (geometryStore) {
      this.geometryStore = geometryStore;
    }
  }

  /** Sets the GeometryStore. Safe to call after construction if not provided to constructor. */
  setGeometryStore(geometryStore: GeometryStore): void {
    this.geometryStore = geometryStore;
  }

  /** @deprecated Use setGeometryStore */
  setPolygonStore(polygonStore: GeometryStore): void {
    this.geometryStore = polygonStore;
  }

  /** Generates a stable UUID for a new shape. Called before addPolygon/rectangle/ellipse. */
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

  // ==================== POLYGON RECORD METHODS ====================

  /** Records a polygon insert operation and pushes it onto the undo stack. */
  recordPolygonInsert(polygon: Polygon): void {
    const entry: PolygonInsertEntry = { type: 'polygon-insert', polygon };
    this.push(entry);
  }

  /** Records a polygon move operation (all vertices shifted) and pushes it onto the undo stack. */
  recordPolygonMove(id: Id, beforeSegments: Array<PolygonSegment>, afterSegments: Array<PolygonSegment>): void {
    const entry: PolygonMoveEntry = {
      type: 'polygon-move',
      id,
      beforeSegments,
      afterSegments,
    };
    this.push(entry);
  }

  /** Records a polygon vertex move and pushes it onto the undo stack. */
  recordPolygonMoveVertex(
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

  /** Records a polygon control point move and pushes it onto the undo stack. */
  recordPolygonMoveControlPoint(
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

  /** Records a polygon delete operation and pushes it onto the undo stack. */
  recordPolygonDelete(polygon: Polygon): void {
    const entry: PolygonDeleteEntry = { type: 'polygon-delete', polygon };
    this.push(entry);
  }

  /** Records a polygon point insert operation and pushes it onto the undo stack. */
  recordPolygonInsertPoint(
    id: Id,
    segmentIndex: number,
    newPoint: SheetPosition,
    beforeSegments: Array<PolygonSegment>,
    afterSegments: Array<PolygonSegment>,
  ): void {
    const entry: PolygonInsertPointEntry = {
      type: 'polygon-insert-point',
      id,
      segmentIndex,
      newPoint,
      beforeSegments,
      afterSegments,
    };
    this.push(entry);
  }

  // ==================== RECTANGLE RECORD METHODS ====================

  /** Records a rectangle insert operation and pushes it onto the undo stack. */
  recordRectangleInsert(rectangle: Rectangle): void {
    const entry: RectangleInsertEntry = { type: 'rectangle-insert', rectangle };
    this.push(entry);
  }

  /** Records a rectangle move/resize operation and pushes it onto the undo stack. */
  recordRectangleMove(id: Id, before: Rectangle, after: Rectangle): void {
    const entry: RectangleMoveEntry = { type: 'rectangle-move', id, before, after };
    this.push(entry);
  }

  /** Records a rectangle delete operation and pushes it onto the undo stack. */
  recordRectangleDelete(rectangle: Rectangle): void {
    const entry: RectangleDeleteEntry = { type: 'rectangle-delete', rectangle };
    this.push(entry);
  }

  // ==================== ELLIPSE RECORD METHODS ====================

  /** Records an ellipse insert operation and pushes it onto the undo stack. */
  recordEllipseInsert(ellipse: Ellipse): void {
    const entry: EllipseInsertEntry = { type: 'ellipse-insert', ellipse };
    this.push(entry);
  }

  /** Records an ellipse move/resize operation and pushes it onto the undo stack. */
  recordEllipseMove(id: Id, before: Ellipse, after: Ellipse): void {
    const entry: EllipseMoveEntry = { type: 'ellipse-move', id, before, after };
    this.push(entry);
  }

  /** Records an ellipse delete operation and pushes it onto the undo stack. */
  recordEllipseDelete(ellipse: Ellipse): void {
    const entry: EllipseDeleteEntry = { type: 'ellipse-delete', ellipse };
    this.push(entry);
  }

  // ==================== INTERNAL METHODS ====================

  /** Pushes an entry onto the undo stack and clears the redo stack. */
  private push(entry: UndoEntry): void {
    this.undoStack.push(entry);
    this.redoStack = [];
    this.emit('stacksChange');
  }

  /** Applies the forward (redo) side of an entry. */
  private applyForward(entry: UndoEntry): void {
    if (!this.geometryStore) return;
    switch (entry.type) {
      case 'polygon-insert':
        this.geometryStore.addPolygonDirect(entry.polygon);
        break;
      case 'polygon-delete':
        this.geometryStore.deletePolygonDirect(entry.polygon.id);
        break;
      case 'polygon-insert-point':
        this.geometryStore.updatePolygon(entry.id, { points: entry.afterSegments });
        break;
      case 'polygon-move':
        this.geometryStore.updatePolygon(entry.id, { points: entry.afterSegments });
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.afterPoint,
          };
          this.geometryStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.afterPoint };
          this.geometryStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'rectangle-insert':
        this.geometryStore.addRectangleDirect(entry.rectangle);
        break;
      case 'rectangle-delete':
        this.geometryStore.deleteRectangleDirect(entry.rectangle.id);
        break;
      case 'rectangle-move':
        this.geometryStore.updateRectangle(entry.id, entry.after);
        break;
      case 'ellipse-insert':
        this.geometryStore.addEllipseDirect(entry.ellipse);
        break;
      case 'ellipse-delete':
        this.geometryStore.deleteEllipseDirect(entry.ellipse.id);
        break;
      case 'ellipse-move':
        this.geometryStore.updateEllipse(entry.id, entry.after);
        break;
    }
  }

  /** Applies the reverse (undo) side of an entry. */
  private applyReverse(entry: UndoEntry): void {
    if (!this.geometryStore) return;
    switch (entry.type) {
      case 'polygon-insert':
        this.geometryStore.deletePolygonDirect(entry.polygon.id);
        break;
      case 'polygon-delete':
        this.geometryStore.addPolygonDirect(entry.polygon);
        break;
      case 'polygon-insert-point':
        this.geometryStore.updatePolygon(entry.id, { points: entry.beforeSegments });
        break;
      case 'polygon-move':
        this.geometryStore.updatePolygon(entry.id, { points: entry.beforeSegments });
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.beforePoint,
          };
          this.geometryStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.polygons.find(p => p.id === entry.id);
        if (polygon) {
          const segments = [...polygon.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.beforePoint };
          this.geometryStore.updatePolygon(entry.id, { points: segments });
        }
        break;
      }
      case 'rectangle-insert':
        this.geometryStore.deleteRectangleDirect(entry.rectangle.id);
        break;
      case 'rectangle-delete':
        this.geometryStore.addRectangleDirect(entry.rectangle);
        break;
      case 'rectangle-move':
        this.geometryStore.updateRectangle(entry.id, entry.before);
        break;
      case 'ellipse-insert':
        this.geometryStore.deleteEllipseDirect(entry.ellipse.id);
        break;
      case 'ellipse-delete':
        this.geometryStore.addEllipseDirect(entry.ellipse);
        break;
      case 'ellipse-move':
        this.geometryStore.updateEllipse(entry.id, entry.before);
        break;
    }
  }
}
