import EventEmitter from 'eventemitter3';
import { v4 as uuidV4 } from 'uuid';
import { type Id } from '@/lib/geometry';
import { EllipseComponent, PolygonComponent, RectangleComponent } from '@/lib/geometry';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { SheetPosition } from '@/lib/viewport/types';
import { UndoEntry } from './types';
import { type TransactionEntity } from './types';

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

  private activeTransaction: Array<UndoEntry> | null = null;

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

  /** Generates a stable UUID for a new shape. Called before addPolygon/rectangle/ellipse.
   * The counter is incremented after each call to help avoid ID collisions after load. */
  generateStableId(prefix?: string): Id {
    this.stableIdCounter = this.stableIdCounter + 1;
    if (typeof prefix === 'string') {
      return `${prefix}_${uuidV4()}`;
    } else {
      return uuidV4();
    }
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
  undo() {
    const entry = this.undoStack.pop();
    if (typeof entry === 'undefined') {
      return;
    }

    this.applyReverse(entry);
    this.redoStack.push(entry);
    this.emit('stacksChange');
  }

  /** Redoes the most recently undone operation, pushing it back onto the undo stack. */
  redo() {
    const entry = this.redoStack.pop();
    if (typeof entry === 'undefined') {
      return;
    }

    this.applyForward(entry);
    this.undoStack.push(entry);
    this.emit('stacksChange');
  }

  /** Returns a copy of the current undo stack. */
  getUndoStack(): Array<UndoEntry> {
    return this.undoStack;
  }

  /** Returns a copy of the current redo stack. */
  getRedoStack(): Array<UndoEntry> {
    return this.redoStack;
  }

  /** Replaces the undo stack entirely. Used during serialization load. */
  setUndoStack(stack: Array<UndoEntry>): void {
    this.undoStack = stack;
  }

  /** Replaces the redo stack entirely. Used during serialization load. */
  setRedoStack(stack: Array<UndoEntry>): void {
    this.redoStack = stack;
  }

  private stableIdCounter: number = 0;

  /** Returns the current stable ID counter value. */
  getStableIdCounter(): number {
    return this.stableIdCounter;
  }

  /** Sets the stable ID counter. Used during serialization load to avoid ID collisions. */
  setStableIdCounter(counter: number): void {
    this.stableIdCounter = counter;
  }

  /** Applies a series of undo steps for the given `purpose`, which can be played back
   * forwards/backwards atomically.
   *
   * IMPORTANT: this does NOT actually run the passed `scopeFn` when undoing / redoing. This just
   * captures the UndOStack entries and replays THOSE in a static fashion.
   */
  applyTransaction<T = void>(purpose: string, scopeFn: () => T): T;
  applyTransaction<T = void>(purpose: string, scopeFn: () => Promise<T>): Promise<T>;
  applyTransaction<T = void>(purpose: string, scopeFn: () => T | Promise<T>): T | Promise<T> {
    const previousActiveTransaction = this.activeTransaction;
    this.activeTransaction = [];

    const complete = (result: T) => {
      const transactionEntry: TransactionEntity = {
        type: 'transaction',
        purpose,
        forwardsEntries: this.activeTransaction ?? [],
      };

      if (previousActiveTransaction !== null) {
        // Add a nested transaction to the top level transaction
        this.activeTransaction = [...previousActiveTransaction, transactionEntry];
      } else {
        // At the bottom of the transaction stack - so add to the undo stack properly
        this.activeTransaction = null;
        this.push(transactionEntry);
      }

      return result;
    };

    const returnValue = scopeFn();
    if (returnValue instanceof Promise) {
      return returnValue.then(complete);
    } else {
      return complete(returnValue);
    }
  }

  // ==================== INTERNAL METHODS ====================

  /**
   * Pushes an entry onto the undo stack, clears the redo stack, and runs the forward
   * side of the operation. Use this instead of push() when the caller has not already
   * performed the forward mutation.
   */
  apply(entry: UndoEntry): void {
    this.push(entry);
    this.applyForward(entry);
  }

  /** Pushes an entry onto the undo stack and clears the redo stack. */
  public push(entry: UndoEntry): void {
    // If a transaction is active, then add to it instead of adding each action directly.
    if (this.activeTransaction) {
      this.activeTransaction.push(entry);
      return;
    }

    this.undoStack.push(entry);
    this.redoStack = [];
    this.emit('stacksChange');
  }

  /** Applies the forward (redo) side of an entry. */
  private applyForward(entry: UndoEntry): void {
    if (!this.geometryStore) {
      return;
    }
    switch (entry.type) {
      case 'transaction':
        for (const action of entry.forwardsEntries) {
          this.applyForward(action);
        }
        break;
      case 'insert':
        this.geometryStore.addDirect(entry.geometry);
        break;
      case 'delete':
        this.geometryStore.deleteDirect(entry.geometry.id);
        break;
      case 'fill-color':
        this.geometryStore.setFillColorDirect(entry.id, entry.afterColor);
        break;
      case 'render-order':
        this.geometryStore.setRenderOrderDirect(entry.id, entry.afterOrder);
        break;
      case 'link-dimensions':
        this.geometryStore.setLinkDimensionsDirect(entry.id, entry.afterLink);
        break;
      case 'polygon-insert-point':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.afterSegments,
          }),
        );
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.afterSegments,
          }),
        );
        break;
      case 'rectangle-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RectangleComponent, (old) =>
          RectangleComponent.update(old, entry.after),
        );
        break;
      case 'ellipse-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, EllipseComponent, (old) =>
          EllipseComponent.update(old, entry.after),
        );
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.afterPoint,
          };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points: segments,
            }),
          );
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.afterPoint };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points: segments,
            }),
          );
        }
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          const polygon = this.geometryStore.polygons.find((p) => p.id === move.id);
          if (polygon) {
            const segments = [...PolygonComponent.get(polygon).points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: move.afterPoint,
            };
            this.geometryStore.updateByIdWithComponentDirect(move.id, PolygonComponent, (old) =>
              PolygonComponent.update(old, {
                points: segments,
              }),
            );
          }
        }
        break;
      }
      case 'polygon-close':
        if (entry.afterClosed) {
          this.geometryStore.closePolygonDirect(entry.id);
        } else {
          this.geometryStore.openPolygonDirect(entry.id);
        }
        break;
      case 'polygon-open-at-index':
        this.geometryStore.setPolygonOpenAtIndexDirect(entry.id, entry.afterIndex);
        break;
      case 'rectangle-to-polygon':
        this.geometryStore.addDirect(entry.polygon);
        this.geometryStore.deleteDirect(entry.rectangle.id);
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.polygon);
        this.geometryStore.deleteDirect(entry.ellipse.id);
        break;
      case 'linear-constraint-insert':
        this.geometryStore.addConstraintDirect(entry.constraint);
        break;
      case 'linear-constraint-delete':
        this.geometryStore.deleteConstraintDirect(entry.constraint.id);
        break;
      case 'linear-constraint-move-endpoints':
        this.geometryStore.updateConstraintDirect(entry.id, {
          pointA: entry.afterPointA,
          pointB: entry.afterPointB,
        });
        break;
      case 'linear-constraint-move-label':
        this.geometryStore.updateConstraintDirect(entry.id, {
          connectorLineOffsetPx: entry.afterOffsetPx,
        });
        break;
      case 'linear-constraint-change-length':
        this.geometryStore.updateConstraintDirect(entry.id, {
          constrainedLength: entry.afterLength,
        });
        break;
      case 'polygon-translate': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const translate = (p: SheetPosition): SheetPosition => {
            return new SheetPosition(p.x + entry.deltaX, p.y + entry.deltaY);
          };
          const points = PolygonComponent.get(polygon).points.map((seg) => {
            switch (seg.type) {
              case 'point': {
                return { ...seg, point: translate(seg.point) };
              }
              case 'arc-quadratic': {
                return {
                  ...seg,
                  point: translate(seg.point),
                  controlPoint: translate(seg.controlPoint),
                };
              }
              case 'arc-cubic': {
                return {
                  ...seg,
                  point: translate(seg.point),
                  controlPointA: translate(seg.controlPointA),
                  controlPointB: translate(seg.controlPointB),
                };
              }
            }
          });
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points,
            }),
          );
        }
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.afterSegments,
          }),
        );
        break;
      default:
        entry satisfies never;
        break;
    }
  }

  /** Applies the reverse (undo) side of an entry. */
  private applyReverse(entry: UndoEntry): void {
    if (!this.geometryStore) {
      return;
    }
    switch (entry.type) {
      case 'transaction':
        // Loop through actions backwards, and undo them.
        for (const action of entry.forwardsEntries.slice().reverse()) {
          this.applyReverse(action);
        }
        break;
      case 'insert':
        this.geometryStore.deleteDirect(entry.geometry.id);
        break;
      case 'delete':
        this.geometryStore.addDirect(entry.geometry);
        break;
      case 'polygon-insert-point':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.beforeSegments,
          }),
        );
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.beforeSegments,
          }),
        );
        break;
      case 'rectangle-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RectangleComponent, (old) =>
          RectangleComponent.update(old, entry.before),
        );
        break;
      case 'ellipse-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, EllipseComponent, (old) =>
          EllipseComponent.update(old, entry.before),
        );
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.beforePoint,
          };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points: segments,
            }),
          );
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.beforePoint };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points: segments,
            }),
          );
        }
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          const polygon = this.geometryStore.polygons.find((p) => p.id === move.id);
          if (polygon) {
            const segments = [...PolygonComponent.get(polygon).points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: move.beforePoint,
            };
            this.geometryStore.updateByIdWithComponentDirect(move.id, PolygonComponent, (old) =>
              PolygonComponent.update(old, {
                points: segments,
              }),
            );
          }
        }
        break;
      }
      case 'rectangle-to-polygon':
        this.geometryStore.addDirect(entry.rectangle);
        this.geometryStore.deleteDirect(entry.polygon.id);
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.ellipse);
        this.geometryStore.deleteDirect(entry.polygon.id);
        break;
      case 'polygon-close':
        if (entry.beforeClosed) {
          this.geometryStore.closePolygonDirect(entry.id);
        } else {
          this.geometryStore.openPolygonDirect(entry.id);
        }
        break;
      case 'polygon-open-at-index':
        this.geometryStore.setPolygonOpenAtIndexDirect(entry.id, entry.beforeIndex);
        break;
      case 'link-dimensions':
        this.geometryStore.setLinkDimensionsDirect(entry.id, entry.beforeLink);
        break;
      case 'fill-color':
        this.geometryStore.setFillColorDirect(entry.id, entry.beforeColor);
        break;
      case 'render-order':
        this.geometryStore.setRenderOrderDirect(entry.id, entry.beforeOrder);
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.ellipse);
        this.geometryStore.deleteDirect(entry.polygon.id);
        break;
      case 'linear-constraint-insert':
        this.geometryStore.deleteConstraintDirect(entry.constraint.id);
        break;
      case 'linear-constraint-delete':
        this.geometryStore.addConstraintDirect(entry.constraint);
        break;
      case 'linear-constraint-move-endpoints':
        this.geometryStore.updateConstraintDirect(entry.id, {
          pointA: entry.beforePointA,
          pointB: entry.beforePointB,
        });
        break;
      case 'linear-constraint-move-label':
        this.geometryStore.updateConstraintDirect(entry.id, {
          connectorLineOffsetPx: entry.beforeOffsetPx,
        });
        break;
      case 'linear-constraint-change-length':
        this.geometryStore.updateConstraintDirect(entry.id, {
          constrainedLength: entry.beforeLength,
        });
        break;
      case 'polygon-translate': {
        const polygon = this.geometryStore.polygons.find((p) => p.id === entry.id);
        if (polygon) {
          const translate = (p: SheetPosition): SheetPosition => {
            return new SheetPosition(p.x - entry.deltaX, p.y - entry.deltaY);
          };
          const points = PolygonComponent.get(polygon).points.map((seg) => {
            switch (seg.type) {
              case 'point': {
                return { ...seg, point: translate(seg.point) };
              }
              case 'arc-quadratic': {
                return {
                  ...seg,
                  point: translate(seg.point),
                  controlPoint: translate(seg.controlPoint),
                };
              }
              case 'arc-cubic': {
                return {
                  ...seg,
                  point: translate(seg.point),
                  controlPointA: translate(seg.controlPointA),
                  controlPointB: translate(seg.controlPointB),
                };
              }
            }
          });
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
            PolygonComponent.update(old, {
              points,
            }),
          );
        }
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) =>
          PolygonComponent.update(old, {
            points: entry.beforeSegments,
          }),
        );
        break;
      default:
        entry satisfies never;
        break;
    }
  }
}
