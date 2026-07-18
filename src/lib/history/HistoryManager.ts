import EventEmitter from 'eventemitter3';
import { v4 as uuidV4 } from 'uuid';
import { type Id } from '@/lib/entity';
import {
  ConstraintComponent,
  DatumComponent,
  FillColorComponent,
  GeometryComponent,
  LinkDimensionsComponent,
  PolygonComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { PolygonData } from '@/lib/entity/geometry/polygon';
import { type Entity } from '@/lib/entity/types';
import { type Sheet } from '@/lib/sheet/Sheet';
import { Length } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import { UndoEntry } from './types';

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
  private sheet: Sheet | null = null;

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

  /** Sets the Sheet reference, enabling sheet config undo entries to be replayed. */
  setSheet(sheet: Sheet): void {
    this.sheet = sheet;
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
   * When `collapseIfSingle` is true and the transaction contains exactly one undo entry, the
   * wrapper transaction is omitted and the single entry is pushed directly. This keeps the undo
   * stack clean for operations that typically produce a single entry (e.g. vertex drag, control
   * point drag, constraint label move).
   *
   * IMPORTANT: this does NOT actually run the passed `scopeFn` when undoing / redoing. This just
   * captures the UndOStack entries and replays THOSE in a static fashion.
   */
  applyTransaction<T = void>(
    purpose: string,
    scopeFn: () => T,
    options?: { collapseIfSingle?: boolean },
  ): T;
  applyTransaction<T = void>(
    purpose: string,
    scopeFn: () => Promise<T>,
    options?: { collapseIfSingle?: boolean },
  ): Promise<T>;
  applyTransaction<T = void>(
    purpose: string,
    scopeFn: () => T | Promise<T>,
    options?: { collapseIfSingle?: boolean },
  ): T | Promise<T> {
    const previousActiveTransaction = this.activeTransaction;
    this.activeTransaction = [];

    const collapseIfSingle = options?.collapseIfSingle ?? false;

    const complete = (result: T) => {
      const capturedEntries = this.activeTransaction ?? [];
      const transactionEntry = UndoEntry.transaction(purpose, capturedEntries);

      if (previousActiveTransaction !== null) {
        // Add a nested transaction to the top level transaction.
        // If collapseIfSingle is true and only one entry was captured, squash the wrapper
        // and push the single entry directly to the parent transaction.
        if (collapseIfSingle && capturedEntries.length === 1) {
          this.activeTransaction = [...previousActiveTransaction, capturedEntries[0]];
        } else {
          this.activeTransaction = [...previousActiveTransaction, transactionEntry];
        }
      } else {
        // At the bottom of the transaction stack - so add to the undo stack properly
        this.activeTransaction = null;
        if (collapseIfSingle && capturedEntries.length === 1) {
          this.push(capturedEntries[0]);
        } else {
          this.push(transactionEntry);
        }
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
        this.geometryStore.deleteByIdDirect(entry.geometry.id);
        break;
      case 'fill-color':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, FillColorComponent, (old) =>
          FillColorComponent.update(old, entry.afterColor),
        );
        break;
      case 'render-order':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RenderOrderComponent, (old) =>
          RenderOrderComponent.update(old, entry.afterOrder),
        );
        break;
      case 'link-dimensions':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, LinkDimensionsComponent, (old) =>
          LinkDimensionsComponent.update(old, entry.afterLink),
        );
        break;
      case 'polygon-insert-point':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.afterSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.afterSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.afterSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.afterSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'rectangle-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) =>
          GeometryComponent.update(old, { ...entry.after, type: 'rectangle' }),
        );
        break;
      case 'ellipse-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) =>
          GeometryComponent.update(old, { ...entry.after, type: 'ellipse' }),
        );
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.afterPoint,
          };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points: segments });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points: segments },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.afterPoint };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points: segments });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points: segments },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          const polygon = this.geometryStore.getByIdWithComponent(move.id, PolygonComponent);
          if (polygon) {
            const segments = [...PolygonComponent.get(polygon).points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: move.afterPoint,
            };
            this.geometryStore.updateByIdWithComponentDirect(move.id, PolygonComponent, (old) => {
              const updated = PolygonComponent.update(old, { points: segments });
              return GeometryComponent.update(
                updated as unknown as Entity<GeometryComponent<PolygonData>>,
                { points: segments },
              ) as unknown as Entity<PolygonComponent>;
            });
          }
        }
        break;
      }
      case 'polygon-close':
        this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          PolygonComponent,
          entry.afterClosed
            ? (old) => {
                const updated = PolygonComponent.closePath(old);
                return GeometryComponent.update(
                  updated as unknown as Entity<GeometryComponent<PolygonData>>,
                  { closed: true, points: updated.components.polygon.points },
                ) as unknown as Entity<PolygonComponent>;
              }
            : (old) => {
                const updated = PolygonComponent.openPath(old);
                return GeometryComponent.update(
                  updated as unknown as Entity<GeometryComponent<PolygonData>>,
                  { closed: false, points: updated.components.polygon.points },
                ) as unknown as Entity<PolygonComponent>;
              },
        );
        break;
      case 'polygon-open-at-index':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { openAtIndex: entry.afterIndex });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { openAtIndex: entry.afterIndex },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'rectangle-to-polygon':
        this.geometryStore.addDirect(entry.polygon);
        this.geometryStore.deleteByIdDirect(entry.rectangle.id);
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.polygon);
        this.geometryStore.deleteByIdDirect(entry.ellipse.id);
        break;
      case 'horizontal-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.afterPointA,
            pointB: entry.afterPointB,
          }),
        );
        break;
      case 'vertical-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.afterPointA,
            pointB: entry.afterPointB,
          }),
        );
        break;
      case 'colinear-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointTarget: entry.afterPointTarget,
            pointA: entry.afterPointA,
            pointB: entry.afterPointB,
          }),
        );
        break;
      case 'perpendicular-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.afterPointA,
            pointCenter: entry.afterPointCenter,
            pointB: entry.afterPointC,
          }),
        );
        break;
      case 'parallel-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.afterPointA,
            pointB: entry.afterPointB,
            pointC: entry.afterPointC,
            pointD: entry.afterPointD,
          }),
        );
        break;
      case 'linear-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.afterPointA,
            pointB: entry.afterPointB,
          }),
        );
        break;
      case 'linear-constraint-move-label':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            connectorLineOffsetPx: entry.afterOffsetPx,
          }),
        );
        break;
      case 'linear-constraint-change-length':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            constrainedLength: entry.afterLength,
          }),
        );
        break;
      case 'polygon-translate': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
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
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.afterSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.afterSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'sheet-width':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyForward - attempting to apply sheet-width, but this.sheet is unset!',
          );
        }
        this.sheet.updateWidthDirect(
          Length.fromSheetUnits(entry.afterWidth.type, entry.afterWidth.magnitude),
        );
        break;
      case 'sheet-height':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyForward - attempting to apply sheet-height, but this.sheet is unset!',
          );
        }
        this.sheet.updateHeightDirect(
          Length.fromSheetUnits(entry.afterHeight.type, entry.afterHeight.magnitude),
        );
        break;
      case 'sheet-default-unit':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyForward - attempting to apply sheet-default-unit, but this.sheet is unset!',
          );
        }
        this.sheet.updateDefaultUnitDirect(entry.afterDefaultUnit);
        break;
      case 'sheet-unit-places':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyForward - attempting to apply sheet-unit-places, but this.sheet is unset!',
          );
        }
        this.sheet.updateUnitPlacesDirect(entry.afterUnitPlaces);
        break;
      case 'datum-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, DatumComponent, (old) =>
          DatumComponent.update(old, entry.after.position),
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
        this.geometryStore.deleteByIdDirect(entry.geometry.id);
        break;
      case 'delete':
        this.geometryStore.addDirect(entry.geometry);
        break;
      case 'polygon-insert-point':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.beforeSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.beforeSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.beforeSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.beforeSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'rectangle-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) =>
          GeometryComponent.update(old, { ...entry.before, type: 'rectangle' }),
        );
        break;
      case 'ellipse-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) =>
          GeometryComponent.update(old, { ...entry.before, type: 'ellipse' }),
        );
        break;
      case 'polygon-move-vertex': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: entry.beforePoint,
          };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points: segments });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points: segments },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-move-control-point': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
        if (polygon) {
          const segments = [...PolygonComponent.get(polygon).points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = { ...seg, [entry.pointKey]: entry.beforePoint };
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points: segments });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points: segments },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          const polygon = this.geometryStore.getByIdWithComponent(move.id, PolygonComponent);
          if (polygon) {
            const segments = [...PolygonComponent.get(polygon).points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: move.beforePoint,
            };
            this.geometryStore.updateByIdWithComponentDirect(move.id, PolygonComponent, (old) => {
              const updated = PolygonComponent.update(old, { points: segments });
              return GeometryComponent.update(
                updated as unknown as Entity<GeometryComponent<PolygonData>>,
                { points: segments },
              ) as unknown as Entity<PolygonComponent>;
            });
          }
        }
        break;
      }
      case 'rectangle-to-polygon':
        this.geometryStore.addDirect(entry.rectangle);
        this.geometryStore.deleteByIdDirect(entry.polygon.id);
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.ellipse);
        this.geometryStore.deleteByIdDirect(entry.polygon.id);
        break;
      case 'polygon-close':
        this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          PolygonComponent,
          entry.beforeClosed
            ? (old) => {
                const updated = PolygonComponent.closePath(old);
                return GeometryComponent.update(
                  updated as unknown as Entity<GeometryComponent<PolygonData>>,
                  { closed: true, points: updated.components.polygon.points },
                ) as unknown as Entity<PolygonComponent>;
              }
            : (old) => {
                const updated = PolygonComponent.openPath(old);
                return GeometryComponent.update(
                  updated as unknown as Entity<GeometryComponent<PolygonData>>,
                  { closed: false, points: updated.components.polygon.points },
                ) as unknown as Entity<PolygonComponent>;
              },
        );
        break;
      case 'polygon-open-at-index':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { openAtIndex: entry.beforeIndex });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { openAtIndex: entry.beforeIndex },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'link-dimensions':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, LinkDimensionsComponent, (old) =>
          LinkDimensionsComponent.update(old, entry.beforeLink),
        );
        break;
      case 'fill-color':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, FillColorComponent, (old) =>
          FillColorComponent.update(old, entry.beforeColor),
        );
        break;
      case 'render-order':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RenderOrderComponent, (old) =>
          RenderOrderComponent.update(old, entry.beforeOrder),
        );
        break;
      case 'ellipse-to-polygon':
        this.geometryStore.addDirect(entry.ellipse);
        this.geometryStore.deleteByIdDirect(entry.polygon.id);
        break;
      case 'horizontal-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.beforePointA,
            pointB: entry.beforePointB,
          }),
        );
        break;
      case 'vertical-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.beforePointA,
            pointB: entry.beforePointB,
          }),
        );
        break;
      case 'colinear-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointTarget: entry.beforePointTarget,
            pointA: entry.beforePointA,
            pointB: entry.beforePointB,
          }),
        );
        break;
      case 'perpendicular-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.beforePointA,
            pointCenter: entry.beforePointCenter,
            pointB: entry.beforePointC,
          }),
        );
        break;
      case 'parallel-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.beforePointA,
            pointB: entry.beforePointB,
            pointC: entry.beforePointC,
            pointD: entry.beforePointD,
          }),
        );
        break;
      case 'linear-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            pointA: entry.beforePointA,
            pointB: entry.beforePointB,
          }),
        );
        break;
      case 'linear-constraint-move-label':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            connectorLineOffsetPx: entry.beforeOffsetPx,
          }),
        );
        break;
      case 'linear-constraint-change-length':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            constrainedLength: entry.beforeLength,
          }),
        );
        break;
      case 'polygon-translate': {
        const polygon = this.geometryStore.getByIdWithComponent(entry.id, PolygonComponent);
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
          this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
            const updated = PolygonComponent.update(old, { points });
            return GeometryComponent.update(
              updated as unknown as Entity<GeometryComponent<PolygonData>>,
              { points },
            ) as unknown as Entity<PolygonComponent>;
          });
        }
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, PolygonComponent, (old) => {
          const updated = PolygonComponent.update(old, { points: entry.beforeSegments });
          return GeometryComponent.update(
            updated as unknown as Entity<GeometryComponent<PolygonData>>,
            { points: entry.beforeSegments },
          ) as unknown as Entity<PolygonComponent>;
        });
        break;
      case 'sheet-width':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyReverse - attempting to apply sheet-width, but this.sheet is unset!',
          );
        }
        this.sheet.updateWidthDirect(
          Length.fromSheetUnits(entry.beforeWidth.type, entry.beforeWidth.magnitude),
        );
        break;
      case 'sheet-height':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyReverse - attempting to apply sheet-height, but this.sheet is unset!',
          );
        }
        this.sheet.updateHeightDirect(
          Length.fromSheetUnits(entry.beforeHeight.type, entry.beforeHeight.magnitude),
        );
        break;
      case 'sheet-default-unit':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyReverse - attempting to apply sheet-default-unit, but this.sheet is unset!',
          );
        }
        this.sheet.updateDefaultUnitDirect(entry.beforeDefaultUnit);
        break;
      case 'sheet-unit-places':
        if (!this.sheet) {
          throw new Error(
            'HistoryManager:applyReverse - attempting to apply sheet-unit-places, but this.sheet is unset!',
          );
        }
        this.sheet.updateUnitPlacesDirect(entry.beforeUnitPlaces);
        break;
      case 'datum-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, DatumComponent, (old) =>
          DatumComponent.update(old, entry.before.position),
        );
        break;
      default:
        entry satisfies never;
        break;
    }
  }
}
