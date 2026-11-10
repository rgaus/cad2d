import EventEmitter from 'eventemitter3';
import { v4 as uuidV4 } from 'uuid';
import { type Id } from '@/lib/entity';
import {
  ConstraintComponent,
  DatumComponent,
  Entity,
  FillColorComponent,
  FrameComponent,
  GeometryComponent,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { AnchorPointComponent } from '@/lib/entity/components/AnchorPointComponent';
import { involuteGearUndoEntries } from '@/lib/entity/components/InvoluteGearComponent';
import { RotationComponent } from '@/lib/entity/components/RotationComponent';
import { PolygonData, type PolygonSegment } from '@/lib/entity/geometry/polygon';
import { type Sheet } from '@/lib/sheet/Sheet';
import { Length } from '@/lib/units/length';
import { GeometryRelativeSheetPosition, type Position, SheetPosition } from '@/lib/viewport/types';
import { FilterComponent } from '../entity/components/FilterComponent';
import { UndoEntry } from './types';

/** History polygon segment payloads are stored in the polygon's local frame. Accept either local
 * GRS points or plain sheet-space points (used by legacy callers) and normalize to local GRS. */
function asLocalSegments(
  segments: Array<PolygonSegment<Position>>,
): Array<PolygonSegment<GeometryRelativeSheetPosition>> {
  return segments as Array<PolygonSegment<GeometryRelativeSheetPosition>>;
}

function asLocalPoint(point: SheetPosition): GeometryRelativeSheetPosition {
  return new GeometryRelativeSheetPosition(point.x, point.y);
}

/** Returns the entity with a single component added (or replaced). */
function addEntityComponent(entity: Entity, key: string, component: object): Entity {
  return {
    ...entity,
    components: { ...entity.components, [key]: component },
  } as Entity;
}

/** Returns the entity with a single component removed. */
function removeEntityComponent(entity: Entity, key: string): Entity {
  const components: Record<string, unknown> = { ...entity.components };
  delete components[key];
  return { ...entity, components } as Entity;
}

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
    options?: { collapseIfSingle?: boolean; omitIfEmpty?: boolean },
  ): T;
  applyTransaction<T = void>(
    purpose: string,
    scopeFn: () => Promise<T>,
    options?: { collapseIfSingle?: boolean; omitIfEmpty?: boolean },
  ): Promise<T>;
  applyTransaction<T = void>(
    purpose: string,
    scopeFn: () => T | Promise<T>,
    options?: { collapseIfSingle?: boolean; omitIfEmpty?: boolean },
  ): T | Promise<T> {
    const previousActiveTransaction = this.activeTransaction;
    this.activeTransaction = [];

    const collapseIfSingle = options?.collapseIfSingle ?? false;
    const omitIfEmpty = options?.omitIfEmpty ?? false;

    const complete = (result: T) => {
      const capturedEntries = this.activeTransaction ?? [];
      const transactionEntry = UndoEntry.transaction(purpose, capturedEntries);

      if (previousActiveTransaction !== null) {
        // Add a nested transaction to the top level transaction.
        // If collapseIfSingle is true and only one entry was captured, squash the wrapper
        // and push the single entry directly to the parent transaction.
        if (collapseIfSingle && capturedEntries.length === 1) {
          this.activeTransaction = [...previousActiveTransaction, capturedEntries[0]];
        } else if (omitIfEmpty && capturedEntries.length === 0) {
          // Skip, capturedEntries is empty
        } else {
          this.activeTransaction = [...previousActiveTransaction, transactionEntry];
        }
      } else {
        // At the bottom of the transaction stack - so add to the undo stack properly
        this.activeTransaction = null;
        if (collapseIfSingle && capturedEntries.length === 1) {
          this.push(capturedEntries[0]);
        } else if (omitIfEmpty && capturedEntries.length === 0) {
          // Skip, capturedEntries is empty
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
      case 'fill-color-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          FillColorComponent.update(old, entry.afterColor),
        );
        break;
      case 'fill-color-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) => FillColorComponent.remove(old));
        break;
      case 'render-order':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RenderOrderComponent, (old) =>
          RenderOrderComponent.update(old, entry.afterOrder),
        );
        break;
      case 'involute-gear-move':
      case 'involute-gear-update':
        involuteGearUndoEntries.applyForward(this.geometryStore, entry);
        break;
      case 'link-dimensions':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, LinkDimensionsComponent, (old) =>
          LinkDimensionsComponent.update(old, entry.afterLink),
        );
        break;
      case 'anchor-point-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, AnchorPointComponent, (old) =>
          AnchorPointComponent.update(old, entry.afterAnchorPoint),
        );
        break;
      case 'anchor-point-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          addEntityComponent(
            old,
            AnchorPointComponent.key,
            AnchorPointComponent.create(entry.afterAnchorPoint),
          ),
        );
        break;
      case 'anchor-point-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          removeEntityComponent(old, AnchorPointComponent.key),
        );
        break;
      case 'rotation-change':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RotationComponent, (old) =>
          RotationComponent.update(old, entry.afterRotation),
        );
        break;
      case 'rotation-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          addEntityComponent(
            old,
            RotationComponent.key,
            RotationComponent.create(entry.afterRotation.angle),
          ),
        );
        break;
      case 'rotation-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          removeEntityComponent(old, RotationComponent.key),
        );
        break;
      case 'polygon-insert-point':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, {
            points: asLocalSegments(entry.afterSegments),
            ...(entry.afterPosition ? { position: entry.afterPosition } : {}),
          });
        });
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const updated = GeometryComponent.update(old, {
            points: asLocalSegments(entry.afterSegments),
            ...(entry.afterPosition ? { position: entry.afterPosition } : {}),
          });
          return this.geometryStore!.resyncGeometryFillColor(updated);
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
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const data = GeometryComponent.get(old);
          const segments = [...data.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: asLocalPoint(entry.afterPoint),
          };
          const updated = GeometryComponent.update(old, { points: segments });
          return this.geometryStore!.resyncGeometryFillColor(updated);
        });
        break;
      }
      case 'polygon-move-control-point': {
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const data = GeometryComponent.get(old);
          const segments = [...data.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = {
            ...seg,
            [entry.pointKey]: asLocalPoint(entry.afterPoint),
          };
          const updated = GeometryComponent.update(old, { points: segments });
          return this.geometryStore!.resyncGeometryFillColor(updated);
        });
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          this.geometryStore.updateByIdWithComponentDirect(move.id, GeometryComponent, (old) => {
            if (!GeometryComponent.isPolygon(old)) {
              return old;
            }
            const data = GeometryComponent.get(old);
            const segments = [...data.points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: asLocalPoint(move.afterPoint),
            };
            const updated = GeometryComponent.update(old, { points: segments });
            return this.geometryStore!.resyncGeometryFillColor(updated);
          });
        }
        break;
      }
      case 'polygon-close':
        if (entry.afterClosed) {
          const geometry = this.geometryStore.getByIdWithComponent(entry.id, GeometryComponent);
          if (geometry && GeometryComponent.isPolygon(geometry)) {
            const data = GeometryComponent.get(geometry);

            // When openAtIndex is 0, the polygon points are already in the correct order
            // and the closing segment is drawn by the renderer from the last point back
            // to the first. No point manipulation is needed — just toggle the flag.
            if (data.openAtIndex === 0) {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    closed: true,
                  });
                },
              );
            } else {
              const splitAt = data.points.length - (data.openAtIndex + 1);
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    points: [
                      ...data.points.slice(splitAt),
                      ...data.points.slice(0, splitAt),
                      { type: 'point' as const, point: data.points[splitAt].point },
                    ],
                    closed: true,
                  });
                },
              );
            }
            const fillColorToSet = data.lastFillColor != null ? data.lastFillColor : DEFAULT_COLOR;
            this.geometryStore.updateByIdDirect(entry.id, (g) => ({
              ...g,
              components: {
                ...g.components,
                ...FillColorComponent.create(fillColorToSet),
              },
            }));
          }
        } else {
          const geometry = this.geometryStore.getByIdWithComponent(entry.id, GeometryComponent);
          if (geometry && GeometryComponent.isPolygon(geometry)) {
            const data = GeometryComponent.get(geometry);
            const currentFillColor = FillColorComponent.getOptional(geometry);

            if (data.openAtIndex === 0) {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    closed: false,
                    lastFillColor: currentFillColor ?? null,
                  });
                },
              );
            } else {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    points: [
                      ...data.points.slice(data.openAtIndex + 1, -1),
                      ...data.points.slice(0, data.openAtIndex + 1),
                    ],
                    closed: false,
                    lastFillColor: currentFillColor ?? null,
                  });
                },
              );
            }
            this.geometryStore.updateByIdDirect(entry.id, (g) => ({
              ...g,
              components: Object.fromEntries(
                Object.entries(g.components).filter(([k]) => k !== 'fillColor'),
              ),
            }));
          }
        }
        break;
      case 'polygon-open-at-index':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, { openAtIndex: entry.afterIndex });
        });
        break;
      case 'rectangle-to-polygon':
      case 'ellipse-to-polygon': {
        const oldId = entry.type === 'rectangle-to-polygon' ? entry.rectangle.id : entry.ellipse.id;
        this.geometryStore.addDirect(entry.polygon);
        for (const datum of entry.datums ?? []) {
          this.geometryStore.addDirect(datum);
        }
        for (const constraint of entry.constraintsAfter ?? []) {
          this.geometryStore.updateByIdDirect(constraint.id, () => constraint);
        }
        const afterFilterIds = new Set((entry.filtersAfter ?? []).map((filter) => filter.id));
        for (const filter of entry.filtersAfter ?? []) {
          this.geometryStore.updateByIdDirect(filter.id, () => filter);
        }
        for (const filter of entry.filtersBefore ?? []) {
          if (!afterFilterIds.has(filter.id)) {
            this.geometryStore.deleteByIdDirect(filter.id);
          }
        }
        this.geometryStore.deleteByIdDirect(oldId);
        break;
      }
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
      case 'coincident-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
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
      case 'linear-constraint-change-axis':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            axis: entry.afterAxis,
          }),
        );
        break;
      case 'polygon-translate': {
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return PolygonData.translate(
            old,
            (p) => new SheetPosition(p.x + entry.deltaX, p.y + entry.deltaY),
          );
        });
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, {
            points: asLocalSegments(entry.afterSegments),
            ...(entry.afterPosition ? { position: entry.afterPosition } : {}),
          });
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
      case 'filter-change-offset': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { offset: entry.afterLength }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'filter-change-geometry-id': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { geometryId: entry.afterGeometryId }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'filter-change-data': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.replaceData(g, entry.afterData),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'constraint-change-data':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.replaceData(g, entry.afterData),
        );
        break;
      case 'mirror-filter-move-endpoints': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) =>
            FilterComponent.update(g, {
              pointA: entry.afterPointA,
              pointB: entry.afterPointB,
            }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'frame-move': {
        const geom = this.geometryStore.getById(entry.id);
        if (!geom || !Entity.hasComponent(geom, FrameComponent)) {
          break;
        }
        this.geometryStore.updateByIdDirect(entry.id, (g) => {
          if (!Entity.hasComponent(g, FrameComponent)) {
            return g;
          }
          return FrameComponent.update(g, {
            upperLeft: entry.afterUpperLeft,
            lowerRight: entry.afterLowerRight,
          });
        });
        break;
      }
      case 'pattern-radial-filter-move-center': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { center: entry.afterCenter }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
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
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, {
            points: asLocalSegments(entry.beforeSegments),
            ...(entry.beforePosition ? { position: entry.beforePosition } : {}),
          });
        });
        break;
      case 'polygon-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const updated = GeometryComponent.update(old, {
            points: asLocalSegments(entry.beforeSegments),
            ...(entry.beforePosition ? { position: entry.beforePosition } : {}),
          });

          return this.geometryStore!.resyncGeometryFillColor(updated);
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
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const data = GeometryComponent.get(old);
          const segments = [...data.points];
          segments[entry.segmentIndex] = {
            ...segments[entry.segmentIndex],
            point: asLocalPoint(entry.beforePoint),
          };
          const updated = GeometryComponent.update(old, { points: segments });
          return this.geometryStore!.resyncGeometryFillColor(updated);
        });
        break;
      }
      case 'polygon-move-control-point': {
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          const data = GeometryComponent.get(old);
          const segments = [...data.points];
          const seg = segments[entry.segmentIndex] as any;
          segments[entry.segmentIndex] = {
            ...seg,
            [entry.pointKey]: asLocalPoint(entry.beforePoint),
          };
          return GeometryComponent.update(old, { points: segments });
        });
        break;
      }
      case 'polygon-move-multiple-vertices': {
        for (const move of entry.moves) {
          this.geometryStore.updateByIdWithComponentDirect(move.id, GeometryComponent, (old) => {
            if (!GeometryComponent.isPolygon(old)) {
              return old;
            }
            const data = GeometryComponent.get(old);
            const segments = [...data.points];
            segments[move.segmentIndex] = {
              ...segments[move.segmentIndex],
              point: asLocalPoint(move.beforePoint),
            };
            const updated = GeometryComponent.update(old, { points: segments });
            return this.geometryStore!.resyncGeometryFillColor(updated);
          });
        }
        break;
      }
      case 'rectangle-to-polygon':
      case 'ellipse-to-polygon': {
        const oldGeometry = entry.type === 'rectangle-to-polygon' ? entry.rectangle : entry.ellipse;
        this.geometryStore.addDirect(oldGeometry);
        for (const constraint of entry.constraintsBefore ?? []) {
          if (this.geometryStore.hasId(constraint.id)) {
            this.geometryStore.updateByIdDirect(constraint.id, () => constraint);
          } else {
            this.geometryStore.addDirect(constraint);
          }
        }
        for (const filter of entry.filtersBefore ?? []) {
          if (this.geometryStore.hasId(filter.id)) {
            this.geometryStore.updateByIdDirect(filter.id, () => filter);
          } else {
            this.geometryStore.addDirect(filter);
          }
        }
        this.geometryStore.deleteByIdDirect(entry.polygon.id);
        for (const datum of entry.datums ?? []) {
          this.geometryStore.deleteByIdDirect(datum.id);
        }
        break;
      }
      case 'polygon-close':
        if (entry.beforeClosed) {
          const geometry = this.geometryStore.getByIdWithComponent(entry.id, GeometryComponent);
          if (geometry && GeometryComponent.isPolygon(geometry)) {
            const data = GeometryComponent.get(geometry);

            if (data.openAtIndex === 0) {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    closed: true,
                  });
                },
              );
            } else {
              const splitAt = data.points.length - (data.openAtIndex + 1);
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    points: [
                      ...data.points.slice(splitAt),
                      ...data.points.slice(0, splitAt),
                      { type: 'point' as const, point: data.points[splitAt].point },
                    ],
                    closed: true,
                  });
                },
              );
            }
            const fillColorToSet = data.lastFillColor != null ? data.lastFillColor : DEFAULT_COLOR;
            this.geometryStore.updateByIdDirect(entry.id, (g) => ({
              ...g,
              components: {
                ...g.components,
                ...FillColorComponent.create(fillColorToSet),
              },
            }));
          }
        } else {
          const geometry = this.geometryStore.getByIdWithComponent(entry.id, GeometryComponent);
          if (geometry && GeometryComponent.isPolygon(geometry)) {
            const data = GeometryComponent.get(geometry);
            const currentFillColor = FillColorComponent.getOptional(geometry);

            if (data.openAtIndex === 0) {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    closed: false,
                    lastFillColor: currentFillColor ?? null,
                  });
                },
              );
            } else {
              this.geometryStore.updateByIdWithComponentDirect(
                entry.id,
                GeometryComponent,
                (old) => {
                  if (!GeometryComponent.isPolygon(old)) {
                    return old;
                  }
                  return GeometryComponent.update(old, {
                    points: [
                      ...data.points.slice(data.openAtIndex + 1, -1),
                      ...data.points.slice(0, data.openAtIndex + 1),
                    ],
                    closed: false,
                    lastFillColor: currentFillColor ?? null,
                  });
                },
              );
            }
            this.geometryStore.updateByIdDirect(entry.id, (g) => ({
              ...g,
              components: Object.fromEntries(
                Object.entries(g.components).filter(([k]) => k !== 'fillColor'),
              ),
            }));
          }
        }
        break;
      case 'polygon-open-at-index':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, { openAtIndex: entry.beforeIndex });
        });
        break;
      case 'link-dimensions':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, LinkDimensionsComponent, (old) =>
          LinkDimensionsComponent.update(old, entry.beforeLink),
        );
        break;
      case 'anchor-point-move':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, AnchorPointComponent, (old) =>
          AnchorPointComponent.update(old, entry.beforeAnchorPoint),
        );
        break;
      case 'anchor-point-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          removeEntityComponent(old, AnchorPointComponent.key),
        );
        break;
      case 'anchor-point-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          addEntityComponent(
            old,
            AnchorPointComponent.key,
            AnchorPointComponent.create(entry.beforeAnchorPoint),
          ),
        );
        break;
      case 'rotation-change':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RotationComponent, (old) =>
          RotationComponent.update(old, entry.beforeRotation),
        );
        break;
      case 'rotation-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          removeEntityComponent(old, RotationComponent.key),
        );
        break;
      case 'rotation-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          addEntityComponent(
            old,
            RotationComponent.key,
            RotationComponent.create(entry.beforeRotation.angle),
          ),
        );
        break;
      case 'fill-color':
      case 'fill-color-remove':
        this.geometryStore.updateByIdDirect(entry.id, (old) =>
          FillColorComponent.update(old, entry.beforeColor),
        );
        break;
      case 'fill-color-add':
        this.geometryStore.updateByIdDirect(entry.id, (old) => FillColorComponent.remove(old));
        break;
      case 'render-order':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, RenderOrderComponent, (old) =>
          RenderOrderComponent.update(old, entry.beforeOrder),
        );
        break;
      case 'involute-gear-move':
      case 'involute-gear-update':
        involuteGearUndoEntries.applyReverse(this.geometryStore, entry);
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
      case 'coincident-constraint-move-endpoints':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
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
      case 'linear-constraint-change-axis':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.update(g, {
            axis: entry.beforeAxis,
          }),
        );
        break;
      case 'polygon-translate': {
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return PolygonData.translate(
            old,
            (p) => new SheetPosition(p.x - entry.deltaX, p.y - entry.deltaY),
          );
        });
        break;
      }
      case 'polygon-bounding-box-resize':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, GeometryComponent, (old) => {
          if (!GeometryComponent.isPolygon(old)) {
            return old;
          }
          return GeometryComponent.update(old, {
            points: asLocalSegments(entry.beforeSegments),
            ...(entry.beforePosition ? { position: entry.beforePosition } : {}),
          });
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
      case 'filter-change-offset': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { offset: entry.beforeLength }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'filter-change-geometry-id': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { geometryId: entry.beforeGeometryId }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'filter-change-data': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.replaceData(g, entry.beforeData),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'constraint-change-data':
        this.geometryStore.updateByIdWithComponentDirect(entry.id, ConstraintComponent, (g) =>
          ConstraintComponent.replaceData(g, entry.beforeData),
        );
        break;
      case 'mirror-filter-move-endpoints': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) =>
            FilterComponent.update(g, {
              pointA: entry.beforePointA,
              pointB: entry.beforePointB,
            }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      case 'frame-move': {
        const geom = this.geometryStore.getById(entry.id);
        if (!geom || !Entity.hasComponent(geom, FrameComponent)) {
          break;
        }
        this.geometryStore.updateByIdDirect(entry.id, (g) => {
          if (!Entity.hasComponent(g, FrameComponent)) {
            return g;
          }
          return FrameComponent.update(g, {
            upperLeft: entry.beforeUpperLeft,
            lowerRight: entry.beforeLowerRight,
          });
        });
        break;
      }
      case 'pattern-radial-filter-move-center': {
        const updates = this.geometryStore.updateByIdWithComponentDirect(
          entry.id,
          FilterComponent,
          (g) => FilterComponent.update(g, { center: entry.beforeCenter }),
        );
        if (updates) {
          this.geometryStore.resyncFilterAttachedGeometryFillColor(updates[1 /* after */]);
        }
        break;
      }
      default:
        entry satisfies never;
        break;
    }
  }
}
