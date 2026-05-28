import { ScreenPosition, SheetPosition, type ViewportState, LineSegment, QuadraticCurve, CubicCurve } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { applySnapping, applySnappingLineSeries, type SnappingOptions, type SnappingLineSeriesOptions } from '@/lib/snapping';
import { midPoint, CohenSutherland, lineSegmentBoundingBox, Intersection, distance, DeCasteljau, boundingBox } from '../math';
import { BaseTool } from './BaseTool';
import { type Id, type PointSegment, type CubicBezierSegment, type QuadraticBezierSegment, type PolygonSegment } from '@/lib/geometry';
import { type WorkingPolygonSource, type WorkingPolygon, type WorkingConstraint } from '@/lib/tools/types';
import { ConstraintEndpoint, LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX, LinearConstraint } from '@/lib/geometry/constraints';
import { Length } from '@/lib/units/length';
import { KeyComboDetector, mapIndexToKeyCombo, type KeyCombo } from '../index-mapper';
import { DEFAULT_COLOR } from '@/lib/geometry/colors';

export type PolygonToolEndpoint = {
  polygonId: Id;
  pointIndex: number;
  isStartPoint: boolean;
};

/** Events emitted by PolygonTool. */
export type PolygonToolEvents = {
  statusTooltipChange: (status: PolygonToolStatusTooltip) => void;
  previewSheetPositionChange: (pos: SheetPosition | null) => void;

  previewSegmentIntersections: (intersections: Array<PreviewSegmentIntersections>) => void;
  previewSegmentIntersectionsEnabled: (enabled: Set<KeyCombo>) => void;
};

export type PreviewSegmentIntersections = {
  otherType: 'polygon' | 'rectangle' | 'ellipse';
  otherId: Id;
  otherSegmentIndex: number;
  keyCombo: string;
  segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  intersectionPoint: SheetPosition;
  splitRatio: number;
};

/** Shared intersection tracking data used in drawing states. Tracks preview segment intersections
  * with other geometry and keyboard shortcuts for enabling them. */
type IntersectionData = {
  intersections: Array<PreviewSegmentIntersections>;
  keyCombos: KeyComboDetector;
  enabledKeyCombos: Set<KeyCombo>;
  lastSegmentHadEnabledIntersections: boolean;
};

function createEmptyIntersectionData(): IntersectionData {
  return {
    intersections: [],
    keyCombos: new KeyComboDetector(),
    enabledKeyCombos: new Set<KeyCombo>(),
    lastSegmentHadEnabledIntersections: false,
  };
}

const INITIAL: PolygonToolState = {
  state: 'idle',
  isHoveringFirstHandle: false,
  source: { type: 'empty' },
};

/** All possible states for the polygon tool. */
type PolygonToolState =
  | { state: 'idle'; isHoveringFirstHandle: boolean; source: WorkingPolygonSource }
  | { state: 'hovering-polygon-endpoint'; polygonId: Id; pointIndex: number; isStartPoint: boolean }
  | {
      /** Actively placing line segments. Transitions to 'hovering-auto-close-point' on auto-close-point hover. */
      state: 'drawing-line';
      isHoveringFirstHandle: boolean;
      altHeld: boolean;
      intersection: IntersectionData;
      pointIndex: number;
      pendingStartPoint: SheetPosition;
      pendingEndPoint: SheetPosition;
    }
  | {
    state: 'drawing-arc-quadratic';
    intersection: IntersectionData;
    pointIndex: number;
    pendingStartPoint: SheetPosition;
    pendingControlPoint: SheetPosition;
    pendingEndPoint: SheetPosition;
  }
  | {
    state: 'drawing-arc-cubic';
    intersection: IntersectionData;
    pointIndex: number;
    activeHandle: 'a' | 'b';
    pendingStartPoint: SheetPosition;
    pendingControlPointA: SheetPosition;
    pendingControlPointB: SheetPosition;
    pendingEndPoint: SheetPosition;
  }
  | {
      /** Mouse is hovering over auto-close point while in drawing-line state. */
      state: 'hovering-auto-close-point';
      isHoveringFirstHandle: boolean;
      altHeldOnFirstHandleHover: boolean;
      intersection: IntersectionData;
    }
  | {
    state: 'closing-arc-quadratic';
    intersection: IntersectionData;
    pointIndex: number;
    pendingStartPoint: SheetPosition;
    pendingControlPoint: SheetPosition;
    pendingEndPoint: SheetPosition;
  }
  | {
    state: 'closing-arc-cubic';
    intersection: IntersectionData;
    pointIndex: number;
    activeHandle: 'a' | 'b';
    pendingStartPoint: SheetPosition;
    pendingControlPointA: SheetPosition;
    pendingControlPointB: SheetPosition;
    pendingEndPoint: SheetPosition;
  };

function getStateIntersectionData(state: PolygonToolState): IntersectionData | null {
  if (state.state === 'idle' || state.state === 'hovering-polygon-endpoint') {
    return null;
  }
  return state.intersection;
}

/** Gets the last point in draw order (for snapping reference).
 * When extending from start, returns points[0].
 * Otherwise returns points.at(-1). */
function getWorkingLastPointInDrawOrder(workingPolygon: WorkingPolygon): SheetPosition | null {
  const source = workingPolygon.source;
  if (source.type === 'existing-polygon' && source.isStartPoint) {
    return workingPolygon.points[0].point;
  }
  return workingPolygon.points.at(-1)?.point ?? null;
}

export type PolygonToolStatusTooltip =
  | 'place-first-point'
  | 'continue-polygon'
  | 'place-next-point'
  | 'place-arc-endpoint'
  | 'place-closing-arc-endpoint'
  | 'arc-quadratic'
  | 'arc-cubic'
  | 'close-polygon'
  | 'close-arc-quadratic'
  | 'close-arc-cubic';

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;
  focusKeyCombo = 'p' as const;

  /** The current polygon tool state machine. */
  state: PolygonToolState = INITIAL;

  /** A list of all constraints applied to each polygon segment, in stored polygon.points order. */
  private constrainedLengths: Array<Length | null> = [];

  private handleWorkingConstraintsChanged = (workingConstraints: Array<WorkingConstraint>) => {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      return;
    }

    // When extending from the start, then the "preview segment" is at the start
    // Otherwise, it's at the end.
    const index = wp.source.type === "existing-polygon" && wp.source.isStartPoint ? 0 : -1;

    const activeWc = workingConstraints.at(index);
    if (activeWc?.constrainedLength && this.constrainedLengths.length > 0) {
      this.constrainedLengths[index >= 0 ? index : this.constrainedLengths.length + index] = activeWc.constrainedLength;
    } else {
      this.constrainedLengths[index >= 0 ? index : this.constrainedLengths.length + index] = null;
    }
  };

  get statusText(): PolygonToolStatusTooltip {
    const workingPolygon = this.getGeometryStore().workingPolygon;
    if (!workingPolygon) {
      if (this.state.state === 'hovering-polygon-endpoint') {
        return 'continue-polygon';
      } else {
        return 'place-first-point';
      }
    }

    switch (this.state.state) {
      case 'idle':
      case 'hovering-auto-close-point': // NOTE: above if should handle this in all real cases
        return 'place-first-point';
      case 'hovering-polygon-endpoint':
        return 'continue-polygon';
      case 'closing-arc-cubic':
        return 'close-arc-cubic';
      case 'closing-arc-quadratic':
        return 'close-arc-quadratic';
      case 'drawing-arc-quadratic':
        return 'arc-quadratic';
      case 'drawing-arc-cubic':
        return 'arc-cubic';
      case 'drawing-line':
        if (this.state.isHoveringFirstHandle) {
          if (this.state.altHeld) {
            return 'place-closing-arc-endpoint';
          } else {
            return 'close-polygon';
          }
        } else if (this.state.altHeld) {
          return 'place-arc-endpoint';
        } else {
          return 'place-next-point';
        }
    }
  }

  /** Updates the internal state. */
  private setState(newState: PolygonToolState) {
    const oldStatusTooltip = this.statusText;
    this.state = newState;
    this.computePreviewIntersectionWithOtherPolygons();
    const newStatusTooltip = this.statusText;

    if (oldStatusTooltip !== newStatusTooltip) {
      this.emit('statusTooltipChange', newStatusTooltip);
    }
  }

  /** Backward-compatible getter for previewSegmentIntersections. */
  get previewSegmentIntersections(): Array<PreviewSegmentIntersections> {
    const data = getStateIntersectionData(this.state);
    return data ? data.intersections : [];
  }

  /** Backward-compatible setter for previewSegmentIntersections. */
  set previewSegmentIntersections(value: Array<PreviewSegmentIntersections>) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.intersections = value;
      data.keyCombos.clear().setKeyCombos(value.map(i => i.keyCombo));
    }
  }

  /** Backward-compatible getter for previewSegmentIntersectionsEnabled. */
  get previewSegmentInteractionsEnabled(): Set<KeyCombo> {
    const data = getStateIntersectionData(this.state);
    return data ? data.enabledKeyCombos : new Set<KeyCombo>();
  }

  /** Backward-compatible setter for previewSegmentIntersectionsEnabled. */
  set previewSegmentInteractionsEnabled(value: Set<KeyCombo>) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.enabledKeyCombos = value;
    }
  }

  /** Backward-compatible getter for previewSegmentInteractionsKeyCombos. */
  get previewSegmentInteractionsKeyCombos(): KeyComboDetector {
    const data = getStateIntersectionData(this.state);
    return data ? data.keyCombos : new KeyComboDetector();
  }

  /** Sets key combos on the intersection data if available. For testing use. */
  setKeyCombos(keyCombos: Array<string>): void {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.keyCombos.setKeyCombos(keyCombos);
    }
  }

  /** Returns the current hovering endpoint of polygon, or null. */
  getHoveringEndpointOfPolygon(): { polygonId: Id; pointIndex: number; isStartPoint: boolean } | null {
    if (this.state.state === 'hovering-polygon-endpoint') {
      return { polygonId: this.state.polygonId, pointIndex: this.state.pointIndex, isStartPoint: this.state.isStartPoint };
    }
    return null;
  }

  /** Sets the hovering endpoint state. Transitions to/from hovering-polygon-endpoint state. */
  setHoveringEndpointOfPolygon(endpoint: { polygonId: Id; pointIndex: number; isStartPoint: boolean } | null): void {
    if (endpoint) {
      this.setState({ state: 'hovering-polygon-endpoint', ...endpoint });
    } else if (this.state.state === 'hovering-polygon-endpoint') {
      this.setState({ state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } });
    }
  }

  handleToolBlur(): void {
    const store = this.getGeometryStore();
    store.clearWorkingPolygon();
    store.clearWorkingConstraints();
    store.off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
    this.constrainedLengths = [];
    this.setState({ state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } });
    this.emit('previewSegmentIntersections', []);
    this.emit('previewSegmentIntersectionsEnabled', new Set());
  }

  /** Handles a click in the polygon tool. */
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState) {
    const worldPos = screenPos.toWorld(viewport);

    return this.getGeometryStore().setWorkingPolygon((wp) => {
      switch (this.state.state) {
        case 'idle': {
          const sheetPos = worldPos.toSheet();
          const snapped = this.applySnapping(sheetPos);
          this.setState({
            state: 'drawing-line',
            isHoveringFirstHandle: false,
            altHeld: false,
            intersection: createEmptyIntersectionData(),
            pointIndex: 1,
            pendingStartPoint: snapped,
            pendingEndPoint: snapped,
          });

          const geometryStore = this.getGeometryStore();
          geometryStore.setWorkingConstraints([
            {
              type: "linear",
              pointA: { type: "point", point: snapped },
              pointB: { type: "point", point: snapped },
              constrainedLength: null,
              connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
              disabled: false,
              shadowsConstraintId: null,
            },
          ]);
          this.constrainedLengths = [null];
          geometryStore.on('workingConstraintsChanged', this.handleWorkingConstraintsChanged);

          return {
            points: [
              { type: 'point', point: snapped },
              { type: 'point', point: snapped },
            ],
            previewPoint: snapped,
            pendingArcEndPoint: null,
            source: { type: 'empty' },
          };
        }

        case 'hovering-polygon-endpoint': {
          const sheetPos = worldPos.toSheet();
          const snapped = this.applySnapping(sheetPos);

          const polygon = this.getGeometryStore().getPolygonById(this.state.polygonId);
          if (!polygon || polygon.closed) {
            return wp;
          }

          const source: WorkingPolygonSource = {
            type: 'existing-polygon',
            polygonId: this.state.polygonId,
            isStartPoint: this.state.isStartPoint,
            autoClosePoint: this.state.isStartPoint ? polygon.points[polygon.points.length - 1].point : polygon.points[0].point,
          };

          // 1. Determine the points list for the new working polygon entry
          let pointsCopy: Array<PolygonSegment>;
          let pendingPointWorkingConstraint: WorkingConstraint;
          if (this.state.isStartPoint) {
            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: 0,
              pendingStartPoint: snapped,
              pendingEndPoint: polygon.points[0].point,
            });

            pointsCopy = [{ type: 'point', point: snapped }, ...polygon.points];

            pendingPointWorkingConstraint = {
              type: "linear",
              pointA: { type: "point", point: snapped },
              pointB: { type: "point", point: polygon.points[0].point },
              constrainedLength: null,
              connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
              disabled: false,
              shadowsConstraintId: null,
            };
          } else {
            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: polygon.points.length,
              pendingStartPoint: polygon.points.at(-1)!.point,
              pendingEndPoint: snapped,
            });

            pointsCopy = [...polygon.points, { type: 'point', point: snapped }];

            pendingPointWorkingConstraint = {
              type: "linear",
              pointA: { type: "point", point: snapped },
              pointB: { type: "point", point: polygon.points.at(-1)!.point },
              constrainedLength: null,
              connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
              disabled: false,
              shadowsConstraintId: null,
            };
          }

          // 2. Find any existing constraints connecting polygon segments, and use this
          // to recomstruct the working constraints list / this.constrainedLengths
          const geometryStore = this.getGeometryStore();
          this.constrainedLengths = [];
          let workingConstraints: Array<WorkingConstraint> = [];
          for (let i = 0; i < polygon.points.length - 1 /* convert points -> segments */; i += 1) {
            const matchingConstraint = geometryStore.constraints.find((c) => {
              // FIXME: also handle cosntraints which are inverted here
              return (
                c.type === 'linear' &&
                c.pointA.type === 'locked-polygon' && c.pointA.pointIndex === i &&
                c.pointB.type === 'locked-polygon' && c.pointB.pointIndex === i+1
              );
            });

            let length = null;
            if (matchingConstraint) {
              length = matchingConstraint.constrainedLength;
              workingConstraints.push({
                type: "linear",
                pointA: matchingConstraint.pointA,
                pointB: matchingConstraint.pointB,
                constrainedLength: matchingConstraint.constrainedLength,
                connectorLineOffsetPx: matchingConstraint.connectorLineOffsetPx,
                disabled: true,
                shadowsConstraintId: matchingConstraint.id,
              });
            }

            this.constrainedLengths.push(length);
          }
          // Add final "pending point" working constraint at the end
          if (source.isStartPoint) {
            workingConstraints.unshift(pendingPointWorkingConstraint);
            this.constrainedLengths.unshift(null);
          } else {
            workingConstraints.push(pendingPointWorkingConstraint);
            this.constrainedLengths.push(null);
          }
          console.log('INITIAL WCS', this.constrainedLengths, workingConstraints, source.isStartPoint);

          geometryStore.setWorkingConstraints(workingConstraints);
          geometryStore.on('workingConstraintsChanged', this.handleWorkingConstraintsChanged);

          return {
            points: pointsCopy,
            previewPoint: null,
            pendingArcEndPoint: null,
            source,
          };
        }

        case 'drawing-line': {
          if (!wp) {
            throw new Error('drawing-line: working polygon must be set.');
          }
          const sheetPos = worldPos.toSheet();
          const snapped = this.computePreviewSnappedPos(sheetPos);

          this.emit('previewSheetPositionChange', null);

          // User held alt, so start a curve
          if (this.toolManager.getAltHeld()) {
            const isClosing = this.state.isHoveringFirstHandle;

            // Alt held, so start a curve
            if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
              // User extending polygon from the start point, so add the next point to the front
              this.setState({
                state: isClosing ? 'closing-arc-quadratic' : 'drawing-arc-quadratic',
                intersection: this.state.intersection,
                pointIndex: 1,
                pendingStartPoint: isClosing ? wp.points.at(-1)!.point : snapped,
                pendingControlPoint: snapped,
                pendingEndPoint: wp.points[0].point,
              });

              // Remove the preview point linear constraint, this doesn't apply to curves
              this.constrainedLengths.shift();
              this.getGeometryStore().setWorkingConstraints((wcs) => wcs.slice(1));

              return {
                ...wp,
                points: [
                  { type: 'point', point: snapped },
                  {
                    type: 'arc-quadratic',
                    controlPoint: snapped,
                    point: wp.points[1 /* preview segment */].point,
                  },
                  ...wp.points.slice(1),
                ],
              };
            } else {
              // All other cases - add point to the end.
              this.setState({
                state: isClosing ? 'closing-arc-quadratic' : 'drawing-arc-quadratic',
                intersection: this.state.intersection,
                pointIndex: wp.points.length-1,
                pendingStartPoint: wp.points.at(-1)!.point,
                pendingControlPoint: snapped,
                pendingEndPoint: isClosing ? wp.points[0].point : snapped,
              });

              // Remove the preview point linear constraint, this doesn't apply to curves
              this.constrainedLengths.pop();
              this.getGeometryStore().setWorkingConstraints((wcs) => wcs.slice(0, -1));

              return {
                ...wp,
                points: [
                  // Remove the last "preview" segment at the end which was being adjusted by user mouse movements
                  ...wp.points.slice(0, -1),
                  {
                    type: 'arc-quadratic',
                    controlPoint: snapped,
                    point: snapped,
                  },
                ],
              };
            }
          }

          // At this point we know some sort of segment is going to actually get committed, so split
          // any intersection polygons now before the this.state value gets reset below.
          const updatedIntersectionData = this.splitOtherIntersectingGeometries(
            this.state.intersection,
            wp.source.type === 'existing-polygon' && wp.source.isStartPoint ? 'towards-start' : 'towards-end',
          );

          // User hovering closing handle, so a click means "close the polygon"
          if (this.state.isHoveringFirstHandle) {
            this.completePolygon(
              wp,
              true,
              true, /* keep preview point, this is the final segment */
            );
            return null;
          }

          // Default case - just extend the polygon:
          if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
            // Commit the current working constraint if it has a length; then create a new
            // active working constraint for the preview segment of the next point.
            this.getGeometryStore().setWorkingConstraints((wcs) => {
              const activeWc = wcs[0];
              if (activeWc?.constrainedLength) {
                this.constrainedLengths.unshift(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
                return [
                  {
                    type: "linear",
                    pointA: { type: "point", point: snapped },
                    pointB: { type: "point", point: snapped },
                    constrainedLength: null,
                    connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                    disabled: false,
                    shadowsConstraintId: null,
                  },
                  { ...activeWc, disabled: true },
                  ...wcs.slice(1),
                ];
              } else {
                this.constrainedLengths.unshift(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
                return [
                  {
                    type: "linear",
                    pointA: { type: "point", point: snapped },
                    pointB: { type: "point", point: snapped },
                    constrainedLength: null,
                    connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                    disabled: false,
                    shadowsConstraintId: null,
                  },
                  ...wcs.slice(1),
                ];
              }
            });

            // User extending polygon from the start point, so add the next point to the front
            this.state = {
              ...this.state,
              intersection: updatedIntersectionData,
              pointIndex: 0
            };
            return {
              ...wp,
              points: this.insertIntersectionsIntoWorkingPolygon(
                [
                  { type: 'point', point: snapped }, // New "preview" vertex
                  { type: 'point', point: snapped }, // Updated final vertex
                  ...wp.points.slice(1),
                ],
                'towards-start',
              ),
            };
          } else {
            // Commit the current working constraint if it has a length; then create a new
            // active working constraint for the preview segment of the next point.
            this.getGeometryStore().setWorkingConstraints((wcs) => {
              const activeWc = wcs[wcs.length - 1];
              if (activeWc?.constrainedLength) {
                this.constrainedLengths.push(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
                return [
                  ...wcs.slice(0, -1),
                  { ...activeWc, disabled: true },
                  {
                    type: "linear",
                    pointA: { type: "point", point: snapped },
                    pointB: { type: "point", point: snapped },
                    constrainedLength: null,
                    connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                    disabled: false,
                    shadowsConstraintId: null,
                  },
                ];
              } else {
                this.constrainedLengths.push(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
                return [
                  ...wcs.slice(0, -1),
                  {
                    type: "linear",
                    pointA: { type: "point", point: snapped },
                    pointB: { type: "point", point: snapped },
                    constrainedLength: null,
                    connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                    disabled: false,
                    shadowsConstraintId: null,
                  },
                ];
              }
            });

            this.state = {
              ...this.state,
              intersection: updatedIntersectionData,
              pointIndex: this.state.pointIndex + 1,
            };
            // All other cases - add point to the end.
            return {
              ...wp,
              points: this.insertIntersectionsIntoWorkingPolygon(
                [
                  ...wp.points.slice(0, -1),
                  { type: 'point', point: snapped }, // Updated final vertex
                  { type: 'point', point: snapped }, // New "preview" vertex
                ],
                'towards-end',
              ),
            };
          }
        }

        case 'drawing-arc-quadratic':
        case 'drawing-arc-cubic': {
          if (!wp) {
            throw new Error('drawing-line: working polygon must be set.');
          }
          const sheetPos = worldPos.toSheet();
          const snapped = this.computePreviewSnappedPos(sheetPos);

          this.emit('previewSegmentIntersections', []);
          this.emit('previewSegmentIntersectionsEnabled', new Set());

          // User clicks drawing a curve = sets final control point position
          // and updates the given stored index within the points array
          const pointsCopy = wp.points.slice();
          if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
            // User extending polygon from the start point, so the curve is "backwards"
            // The "start" is actually the "end" of hte curve since segments are being prepended.
            switch (this.state.state) {
              case 'drawing-arc-quadratic':
                pointsCopy[this.state.pointIndex] = {
                  type: 'arc-quadratic',
                  controlPoint: snapped,
                  point: pointsCopy[this.state.pointIndex].point,
                };
                break;
              case 'drawing-arc-cubic':
                if (this.state.activeHandle === 'a') {
                  // If clicking when handle a is active, then set handle a, and handle b gets
                  // set to a default
                  pointsCopy[this.state.pointIndex] = {
                    type: 'arc-cubic',
                    controlPointA: snapped,
                    controlPointB: midPoint(this.state.pendingStartPoint, this.state.pendingEndPoint),
                    point: pointsCopy[this.state.pointIndex].point,
                  };
                } else {
                  // If clicking when handle b is active, then "a" stays the same, "b" gets set.
                  pointsCopy[this.state.pointIndex] = {
                    type: 'arc-cubic',
                    controlPointA: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointA,
                    controlPointB: snapped,
                    point: pointsCopy[this.state.pointIndex].point,
                  };
                }
                break;
            }

            if (this.state.state === 'drawing-arc-cubic' && this.state.activeHandle === 'a') {
              // Cubic has two points to place, so after placing the first, switch the active handle
              // so the user can place the second one
              this.setState({ ...this.state, activeHandle: 'b' });
            } else {
              pointsCopy.unshift({ type: 'point', point: snapped });
              const pendingEndPoint = pointsCopy[this.state.pointIndex].point;
              this.setState({
                state: 'drawing-line',
                isHoveringFirstHandle: false,
                altHeld: false,
                intersection: this.splitOtherIntersectingGeometries(this.state.intersection, 'towards-start'),
                pointIndex: 0,
                pendingStartPoint: snapped,
                pendingEndPoint,
              });

              // Create a new active working constraint for the new preview segment
              this.constrainedLengths.unshift(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
              this.getGeometryStore().setWorkingConstraints((old) => [
                {
                  type: "linear",
                  pointA: { type: "point", point: pendingEndPoint },
                  pointB: { type: "point", point: pendingEndPoint },
                  constrainedLength: null,
                  connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                  disabled: false,
                  shadowsConstraintId: null,
                },
                ...old,
              ]);
            }
          } else {
            // All other cases - close by adding point to the end.
            switch (this.state.state) {
              case 'drawing-arc-quadratic':
                pointsCopy[this.state.pointIndex] = {
                  type: 'arc-quadratic',
                  controlPoint: snapped,
                  point: this.state.pendingEndPoint,
                };
                break;
              case 'drawing-arc-cubic':
                if (this.state.activeHandle === 'a') {
                  // If clicking when handle a is active, then set handle a, and handle b gets
                  // set to a default
                  pointsCopy[this.state.pointIndex] = {
                    type: 'arc-cubic',
                    controlPointA: snapped,
                    controlPointB: midPoint(this.state.pendingStartPoint, this.state.pendingEndPoint),
                    point: this.state.pendingEndPoint,
                  };
                } else {
                  // If clicking when handle b is active, then "a" stays the same, "b" gets set.
                  pointsCopy[this.state.pointIndex] = {
                    type: 'arc-cubic',
                    controlPointA: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointA,
                    controlPointB: snapped,
                    point: this.state.pendingEndPoint,
                  };
                }
                break;
            }

            if (this.state.state === 'drawing-arc-cubic' && this.state.activeHandle === 'a') {
              // Cubic has two points to place, so after placing the first, switch the active handle
              // so the user can place the second one
              this.setState({ ...this.state, activeHandle: 'b' });
            } else {
              pointsCopy.push({ type: 'point', point: snapped });
              const pendingStartPoint = pointsCopy[this.state.pointIndex].point;
              this.setState({
                state: 'drawing-line',
                isHoveringFirstHandle: false,
                altHeld: false,
                intersection: this.splitOtherIntersectingGeometries(this.state.intersection, 'towards-end'),
                pointIndex: pointsCopy.length-1,
                pendingStartPoint,
                pendingEndPoint: snapped,
              });

              // Create a new active working constraint for the new preview segment
              this.constrainedLengths.push(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
              this.getGeometryStore().setWorkingConstraints((old) => [
                ...old,
                {
                  type: "linear",
                  pointA: { type: "point", point: pendingStartPoint },
                  pointB: { type: "point", point: pendingStartPoint },
                  constrainedLength: null,
                  connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                  disabled: false,
                  shadowsConstraintId: null,
                },
              ]);
            }
          }

          return {
            ...wp,
            points: this.insertIntersectionsIntoWorkingPolygon(
              pointsCopy,
              wp.source.type === 'existing-polygon' && wp.source.isStartPoint ? 'towards-end' : 'towards-start',
            ),
          };
        }

        case 'closing-arc-quadratic': {
          if (!wp) {
            throw new Error('closing-arc-quadratic: working polygon must be set.');
          }

          const sheetPos = worldPos.toSheet();
          const snapped = this.computePreviewSnappedPos(sheetPos);

          this.setState({ ...this.state, pendingControlPoint: snapped });

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'arc-quadratic',
            controlPoint: snapped,
            point: pointsCopy[this.state.pointIndex].point,
          };

          return this.completePolygon(
            { ...wp, points: pointsCopy },
            true,
            true, /* keep preview point, this is the final arc */
          );
        }

        case 'closing-arc-cubic': {
          if (!wp) {
            throw new Error('closing-arc-cubic: working polygon must be set.');
          }

          const sheetPos = worldPos.toSheet();
          const snapped = this.computePreviewSnappedPos(sheetPos);

          if (this.state.activeHandle === 'a') {
            // Cubic has two points to place, so after placing the first, switch the active handle
            // so the user can place the second one
            this.setState({ ...this.state, pendingControlPointA: snapped, activeHandle: 'b' });

            let pointsCopy = wp.points.slice();
            pointsCopy[this.state.pointIndex] = {
              type: 'arc-cubic',
              controlPointA: snapped,
              controlPointB: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointB,
              point: pointsCopy[this.state.pointIndex].point,
            };
            return { ...wp, points: pointsCopy };
          }

          this.setState({ ...this.state, pendingControlPointB: snapped });

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'arc-cubic',
            controlPointA: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointA,
            controlPointB: snapped,
            point: pointsCopy[this.state.pointIndex].point,
          };

          return this.completePolygon(
            { ...wp, points: pointsCopy },
            true,
            true, /* keep preview point, this is the final arc */
          );
        }

        default:
          return wp;
      }
    });
  }

  /** Handles mouse move. In polygon mode, updates preview snapping. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState) {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    // console.log('SOURCE', this.state, this.getGeometryStore().workingPolygon);
    const snapped = this.computePreviewSnappedPos(sheetPos);

    return this.getGeometryStore().setWorkingPolygon((wp) => {
      switch (this.state.state) {
        case 'idle': {
          this.emit('previewSheetPositionChange', snapped);
          return wp;
        }

        case 'drawing-line': {
          if (!wp) {
            return null;
          }

          this.setState({ ...this.state, pendingEndPoint: snapped });

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'point',
            point: snapped,
          };

          // When extending from the start, then the "preview segment" is at the start
          // Otherwise, it's at the end.
          const currentWcs = this.getGeometryStore().workingConstraints;
          if (this.constrainedLengths.length > 0) {
            if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
              this.getGeometryStore().setWorkingConstraints([
                { ...currentWcs[0], pointA: { type: "point", point: snapped } },
                ...currentWcs.slice(1),
              ]);
            } else {
              this.getGeometryStore().setWorkingConstraints([
                ...currentWcs.slice(0, -1),
                { ...currentWcs[currentWcs.length-1], pointB: { type: "point", point: snapped } },
              ]);
            }
          }

          return { ...wp, points: pointsCopy };
        }

        case 'drawing-arc-quadratic':
        case 'closing-arc-quadratic': {
          if (!wp) {
            return null;
          }

          this.setState({ ...this.state, pendingControlPoint: snapped });

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'arc-quadratic',
            controlPoint: snapped,
            point: pointsCopy[this.state.pointIndex].point,
          };

          return { ...wp, points: pointsCopy };
        }

        case 'drawing-arc-cubic':
        case 'closing-arc-cubic': {
          if (!wp) {
            return null;
          }

          this.setState({ ...this.state, pendingControlPointA: snapped });

          const pointsCopy = wp.points.slice();
          switch (this.state.activeHandle) {
            case 'a':
              pointsCopy[this.state.pointIndex] = {
                type: 'arc-cubic',
                controlPointA: snapped,
                controlPointB: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointB,
                point: pointsCopy[this.state.pointIndex].point,
              };
              break;
            case 'b':
              pointsCopy[this.state.pointIndex] = {
                type: 'arc-cubic',
                controlPointA: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointA,
                controlPointB: snapped,
                point: pointsCopy[this.state.pointIndex].point,
              };
              break;
          }

          return { ...wp, points: pointsCopy };
        }

        default:
          return wp;
      }
    });
  }

  /** Adds intersections into the working polygon based on the points a user has selected. */
  private insertIntersectionsIntoWorkingPolygon(
    workingPolygonSegments: Array<PolygonSegment>,
    drawDirection: 'towards-start' | 'towards-end',
  ): Array<PolygonSegment> {
    // Must be in an arc drawing / line drawing mode for this to do anything.
    if (
      this.state.state !== 'drawing-line' &&
      this.state.state !== 'drawing-arc-quadratic' &&
      this.state.state !== 'drawing-arc-cubic' &&
      this.state.state !== 'closing-arc-quadratic' &&
      this.state.state !== 'closing-arc-cubic'
    ) {
      return workingPolygonSegments;
    }

    const enabledKeyCombos = this.state.intersection.enabledKeyCombos;
    const intersections = this.state.intersection.intersections.filter(inters => enabledKeyCombos.has(inters.keyCombo));
    if (intersections.length === 0) {
      return workingPolygonSegments;
    }

    // Find the committed segment index based on draw direction
    // The committed segment is NOT the preview segment - it's the last "settled" segment
    // towards-end: segment is between points[length-2] and points[length-1], so index = length-2
    // towards-start: segment is between points[1] and points[2], so index = 1
    const committedSegmentIndex = drawDirection === 'towards-end' ? workingPolygonSegments.length - 2 : 1;

    // Process intersections in order (they're pre-sorted by cursor proximity)
    // Reverse the order for towards-start since we insert before
    const orderedIntersections = drawDirection === 'towards-end' ? intersections.slice().reverse() : intersections;

    let currentSegments = workingPolygonSegments;
    for (const inters of orderedIntersections) {
      const seg = currentSegments[committedSegmentIndex];
      if (typeof seg === 'undefined') {
        break;
      }

      switch (seg.type) {
        case 'point': {
          // Line segment - insert a new point segment at the intersection location
          // Insert AFTER the current point (which represents the segment start)
          const newPoint: PointSegment = { type: 'point', point: inters.intersectionPoint };
          currentSegments = [
            ...currentSegments.slice(0, committedSegmentIndex),
            newPoint,
            ...currentSegments.slice(committedSegmentIndex),
          ];
          this.state.pointIndex += 1;
          break;
        }
        case 'arc-quadratic': {
          // Quadratic arc - split the arc at splitRatio, replace with two arcs
          const arcStartPoint = currentSegments[committedSegmentIndex - 1].point;
          const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(
            { start: arcStartPoint, controlPoint: seg.controlPoint, end: seg.point },
            inters.splitRatio,
          );
          const leftArc: QuadraticBezierSegment = {
            type: 'arc-quadratic',
            point: leftCurve.end,
            controlPoint: leftCurve.controlPoint,
          };
          const rightArc: QuadraticBezierSegment = {
            type: 'arc-quadratic',
            point: rightCurve.end,
            controlPoint: rightCurve.controlPoint,
          };
          currentSegments = [
            ...currentSegments.slice(0, committedSegmentIndex),
            leftArc,
            rightArc,
            ...currentSegments.slice(committedSegmentIndex + 1),
          ];
          this.state.pointIndex += 1;
          break;
        }
        case 'arc-cubic': {
          // Cubic arc - split the arc at splitRatio, replace with two arcs
          const arcStartPoint = currentSegments[committedSegmentIndex - 1].point;
          const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(
            { start: arcStartPoint, controlPointA: seg.controlPointA, controlPointB: seg.controlPointB, end: seg.point },
            inters.splitRatio,
          );
          const leftArc: CubicBezierSegment = {
            type: 'arc-cubic',
            point: leftCurve.end,
            controlPointA: leftCurve.controlPointA,
            controlPointB: leftCurve.controlPointB,
          };
          const rightArc: CubicBezierSegment = {
            type: 'arc-cubic',
            point: rightCurve.end,
            controlPointA: rightCurve.controlPointA,
            controlPointB: rightCurve.controlPointB,
          };
          currentSegments = [
            ...currentSegments.slice(0, committedSegmentIndex),
            leftArc,
            rightArc,
            ...currentSegments.slice(committedSegmentIndex + 1),
          ];
          this.state.pointIndex += 1;
          break;
        }
      }
    }

    return currentSegments;
  }

  /** Computes intersection points between the preview segment and other polygons. */
  private computePreviewIntersectionWithOtherPolygons() {
    if (this.state.state === 'idle' || this.state.state === 'hovering-polygon-endpoint') {
      this.emit('previewSegmentIntersectionsEnabled', new Set());
      this.emit('previewSegmentIntersections', []);
      return;
    }

    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      this.emit('previewSegmentIntersectionsEnabled', new Set());
      this.emit('previewSegmentIntersections', []);
      return;
    }

    // Step 1: compute "preview" segment
    // This is the segment which the user is currently actively placing
    let previewSegment, previewSegmentBoundingBox;
    if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
      switch (wp.points[1].type) {
        case 'point':
          const lineSegment: LineSegment<SheetPosition> = { start: wp.points[0].point, end: wp.points[1].point };
          previewSegmentBoundingBox = lineSegmentBoundingBox(lineSegment);
          previewSegment = lineSegment;
          break;
        case 'arc-quadratic':
          const quadCurve: QuadraticCurve<SheetPosition> = {
            start: wp.points[0].point,
            controlPoint: wp.points[1].controlPoint,
            end: wp.points[1].point,
          };
          previewSegmentBoundingBox = boundingBox([quadCurve.start, quadCurve.end, quadCurve.controlPoint]),
          previewSegment = quadCurve;
          break;
        case 'arc-cubic':
          const cubicCurve: CubicCurve<SheetPosition> = {
            start: wp.points[0].point,
            controlPointA: wp.points[1].controlPointA,
            controlPointB: wp.points[1].controlPointB,
            end: wp.points[1].point,
          };
          previewSegmentBoundingBox = boundingBox([
            cubicCurve.start,
            cubicCurve.end,
            cubicCurve.controlPointA,
            cubicCurve.controlPointB,
          ]),
          previewSegment = cubicCurve;
          break;
      }
    } else {
      const minus1Point = wp.points.at(-1)!;
      switch (minus1Point.type) {
        case 'point':
          const lineSegment: LineSegment<SheetPosition> = { start: wp.points.at(-1)!.point, end: wp.points.at(-2)!.point };
          previewSegmentBoundingBox = lineSegmentBoundingBox(lineSegment);
          previewSegment = lineSegment;
          break;
        case 'arc-quadratic':
          const quadCurve: QuadraticCurve<SheetPosition> = {
            start: wp.points.at(-2)!.point,
            controlPoint: minus1Point.controlPoint,
            end: minus1Point.point,
          };
          previewSegmentBoundingBox = boundingBox([quadCurve.start, quadCurve.end, quadCurve.controlPoint]),
          previewSegment = quadCurve;
          break;
        case 'arc-cubic':
          const cubicCurve: CubicCurve<SheetPosition> = {
            start: wp.points.at(-2)!.point,
            controlPointA: minus1Point.controlPointA,
            controlPointB: minus1Point.controlPointB,
            end: minus1Point.point,
          };
          previewSegmentBoundingBox = boundingBox([
            cubicCurve.start,
            cubicCurve.end,
            cubicCurve.controlPointA,
            cubicCurve.controlPointB,
          ]),
          previewSegment = cubicCurve;
          break;
      }
    }

    const workingPolygonLastPoint = previewSegment.end;

    // Step 2: Compute all intersections between the preview segment and other polygons
    const oldIntersections = this.state.intersection.intersections;
    const previewSegmentIntersections: Array<PreviewSegmentIntersections> = [];
    for (const other of this.getGeometryStore().getAllGeometryAsSegments()) {
      const sourcePolygonId = wp?.source.type === "existing-polygon" ? wp.source.polygonId : null;
      if (other.type === 'polygon' && other.id === sourcePolygonId) {
        // Don't compute self intersections if the given polygon is being extended
        continue;
      }

      for (const { index, segment: otherSegment } of other.segments) {
        let mightIntersect = false;
        if ('controlPoint' in otherSegment) {
          mightIntersect = CohenSutherland.quadraticCurveMightIntersectBoundingBox(
            otherSegment,
            previewSegmentBoundingBox
          );
        } else if ('controlPointA' in otherSegment && 'controlPointB' in otherSegment) {
          mightIntersect = CohenSutherland.cubicCurveMightIntersectBoundingBox(
            otherSegment,
            previewSegmentBoundingBox
          );
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(
            otherSegment,
            previewSegmentBoundingBox
          );
        }
        if (!mightIntersect) {
          continue;
        }

        const intersectionPointsSplitRatioPairs = Intersection.computeSegmentPairIntersections(
          previewSegment,
          otherSegment,
        );

        for (const [intersectionPoint, splitRatio, _] of intersectionPointsSplitRatioPairs) {
          previewSegmentIntersections.push({
            otherType: other.type,
            otherId: other.id,
            otherSegmentIndex: index,
            segment: otherSegment,
            intersectionPoint,
            splitRatio,
            keyCombo: '',
          });
        }
      }
    }

    // Step 3: Sort preview intersections by distance to cursor and assign each a key combo
    const newIntersections = previewSegmentIntersections.sort((a, b) => {
      return distance(workingPolygonLastPoint, a.intersectionPoint) - distance(workingPolygonLastPoint, b.intersectionPoint);
    }).map((inters, index) => ({
      ...inters,
      keyCombo: mapIndexToKeyCombo(index),
    }));

    // Step 4: If the intersections have changes, inject them into the state
    if (!intersectionsEqual(oldIntersections, newIntersections)) {
      let intersectionData: IntersectionData = {
        ...this.state.intersection,
        intersections: newIntersections,
      };

      if (
        newIntersections.length !== oldIntersections.length ||
        newIntersections.find((a, i) => a.keyCombo !== oldIntersections[i]?.keyCombo)
      ) {
        // NOTE: this is mutative, this is fine though because keyCombos is an internal state class
        intersectionData.keyCombos
          .clear()
          .setKeyCombos(newIntersections.map((inters) => inters.keyCombo));

        if (intersectionData.lastSegmentHadEnabledIntersections) {
          intersectionData = { ...intersectionData, enabledKeyCombos: new Set(intersectionData.enabledKeyCombos) };
          for (const i of newIntersections) {
            intersectionData.enabledKeyCombos.add(i.keyCombo);
          }
        } else {
          intersectionData = { ...intersectionData, enabledKeyCombos: new Set() };
        }
        this.emit('previewSegmentIntersectionsEnabled', intersectionData.enabledKeyCombos);
      }

      this.state = { ...this.state, intersection: intersectionData };
      this.emit('previewSegmentIntersections', intersectionData.intersections);
    }
  }

  private splitOtherIntersectingGeometries(
    intersection: IntersectionData,
    drawDirection: 'towards-start' | 'towards-end',
  ): IntersectionData {
    if (this.state.state === 'idle' || this.state.state === 'hovering-polygon-endpoint') {
      return intersection;
    }

    let intersectionData = {
      ...intersection,
      lastSegmentHadEnabledIntersections: intersection.enabledKeyCombos.size > 0,
    };

    const convertedShapeIds = new Map<string, string>();
    // Track index corrections for each polygon that has multiple intersections
    const indexCorrections = new Map<string, number>();

    for (const inters of intersectionData.intersections) {
      if (!intersectionData.enabledKeyCombos.has(inters.keyCombo)) {
        continue;
      }
      // this.getGeometryStore().setWorkingPolygon((wp) => {
      //   if (!wp) {
      //     return null;
      //   }
      //   if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
      //     return { ...wp, points: }
      //   } else {
      //   }
      // });
      // this.addSegmentToWorkingPolygon({ type: 'point', point: inters.intersectionPoint });

      let otherPolygonId = inters.otherId;
      const existingConverted = convertedShapeIds.get(inters.otherId);
      if (existingConverted) {
        otherPolygonId = existingConverted;
      } else {
        switch (inters.otherType) {
          case 'rectangle': {
            const newPoly = this.getGeometryStore().convertRectangleToPolygon(inters.otherId);
            convertedShapeIds.set(inters.otherId, newPoly.id);
            otherPolygonId = newPoly.id;
            break;
          }
          case 'ellipse': {
            const newPoly = this.getGeometryStore().convertEllipseToPolygon(inters.otherId);
            convertedShapeIds.set(inters.otherId, newPoly.id);
            otherPolygonId = newPoly.id;
            break;
          }
          case 'polygon':
            otherPolygonId = inters.otherId;
            break;
        }
      }

      // Apply index correction if we've already split this polygon
      const correction = indexCorrections.get(otherPolygonId) ?? 0;
      const adjustedSegmentIndex = inters.otherSegmentIndex + correction;

      if ('controlPoint' in inters.segment) {
        const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(inters.segment, inters.splitRatio);
        this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
          const points = old.points.slice();

          points.splice(
            adjustedSegmentIndex,
            1,
            { type: 'arc-quadratic', point: leftCurve.end, controlPoint: leftCurve.controlPoint },
            { type: 'arc-quadratic', point: rightCurve.end, controlPoint: rightCurve.controlPoint },
          );
          indexCorrections.set(otherPolygonId, correction + 1 /* subtract 1, add 2 = net of 1 */);

          return { ...old, points };
        });

      } else if ('controlPointA' in inters.segment && 'controlPointB' in inters.segment) {
        const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(inters.segment, inters.splitRatio);
        this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
          const points = old.points.slice();

          points.splice(
            adjustedSegmentIndex,
            1,
            { type: 'arc-cubic', point: leftCurve.end, controlPointA: leftCurve.controlPointA, controlPointB: leftCurve.controlPointB },
            { type: 'arc-cubic', point: rightCurve.end, controlPointA: rightCurve.controlPointA, controlPointB: rightCurve.controlPointB },
          );
          indexCorrections.set(otherPolygonId, correction + 1 /* subtract 1, add 2 = net of 1 */);

          return { ...old, points };
        });

      } else {
        this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
          const points = old.points.slice();
          // Insert the new point AFTER the segment that was split (at otherSegmentIndex + 1)
          points.splice(
            drawDirection === 'towards-start' ? adjustedSegmentIndex + 1 : adjustedSegmentIndex,
            0,
            { type: 'point', point: inters.intersectionPoint },
          );
          indexCorrections.set(otherPolygonId, correction + 1 /* add one for the new point */);

          return { ...old, points };
        });
      }
    }

    return intersectionData;
  }

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
  }

  /** Sets the first handle hover state, transitioning between drawing-line and closing states. */
  setHoveringFirstHandle(hovering: boolean): void {
    switch (this.state.state) {
      case "drawing-line":
        this.setState({ ...this.state, isHoveringFirstHandle: hovering });
        break;
    }
  }

  /** Sets grid snapping options. */
  setSnappingOptions(options: Pick<SnappingOptions, 'primaryGridSize' | 'secondaryGridSize'>): void {
    this.toolManager.snappingOptions = options;
  }

  /** Syncs snapping options to the current viewport scale. */
  syncSnappingOptions(scale: number): void {
    const grid = getGridAtScale(scale);
    this.toolManager.snappingOptions = {
      primaryGridSize: grid.primarySheetUnits,
      secondaryGridSize: grid.secondarySheetUnits,
    };
  }

  /** Computes the snapped position for the polygon tool preview point. */
  computePreviewSnappedPos(sheetPos: SheetPosition): SheetPosition {
    // Figure out the previous point to snap relative to
    let prevPoint: SheetPosition | null = null;
    const workingPolygon = this.getGeometryStore().workingPolygon;
    if (workingPolygon) {
      switch (this.state.state) {
        case 'drawing-arc-quadratic':
        case 'drawing-arc-cubic':
        case 'closing-arc-quadratic':
        case 'closing-arc-cubic':
          // WHen in arc drawing mode, there's no final "preview segment" dimension
          // in workingConstraints / this.constrainedLengths, so don't constrain to a
          // previous point
          prevPoint = null;
          break;

        default:
          prevPoint = workingPolygon.points.at(-2 /* last "committed" point */)?.point ?? null;

          // If extending a polygon from the start, then actually we want the last commited point on the other end.
          const source = workingPolygon.source;
          if (source.type === 'existing-polygon' && source.isStartPoint) {
            prevPoint = workingPolygon.points[1].point;
          }
          break;
      }
    }

    const snapped = prevPoint
      ? this.applySnappingLineSeries(sheetPos, prevPoint)
      : this.applySnapping(sheetPos);

    return snapped;
  }

  /** Handles key down events for polygon drawing and select tool shortcuts. */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (this.state.state === 'drawing-line') {
      this.setState({ ...this.state, altHeld: this.toolManager.getAltHeld() });
    }

    if (event.key === 'Escape') {
      this.abortPolygon();
      return true;
    } else if (event.key === 'Backspace') {
      this.clearLastPolygonSegment();
      return true;
    } else if (event.key === 'Enter') {
      this.getGeometryStore().setWorkingPolygon((wp) => {
        if (wp) {
          return this.completePolygon(wp, false);
        } else {
          return null;
        }
      });
      return true;
    } else if (["drawing-arc-quadratic", "closing-arc-quadratic"].includes(this.state.state) && event.key === 'B') {
      this.setArcDrawMode('cubic');
      return true;
    } else if (["drawing-arc-cubic", "closing-arc-cubic"].includes(this.state.state) && event.key === 'M') {
      this.setArcDrawMode('quadratic');
      return true;
    }

    let processedKey = false;
    const intersectionData = getStateIntersectionData(this.state);
    if (intersectionData) {
      if (event.key.length === 1 && event.key.charCodeAt(0) >= 97 && event.key.charCodeAt(0) <= 122) {
        const matchingKeyCombo = intersectionData.keyCombos.push(event);
        if (matchingKeyCombo !== null) {
          if (intersectionData.enabledKeyCombos.has(matchingKeyCombo)) {
            intersectionData.enabledKeyCombos.delete(matchingKeyCombo);
            intersectionData.lastSegmentHadEnabledIntersections = false;
          } else {
            intersectionData.enabledKeyCombos.add(matchingKeyCombo);
          }

          this.emit('previewSegmentIntersectionsEnabled', new Set(intersectionData.enabledKeyCombos.values()));
          processedKey = true;
        }
      }
    }
    return processedKey;
  }

  handleKeyUp(_event: KeyboardEvent): boolean {
    if (this.state.state === 'drawing-line') {
      this.setState({ ...this.state, altHeld: this.toolManager.getAltHeld() });
      return true;
    }
    return false;
  }

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    if ((this.state.state === 'drawing-arc-quadratic' || this.state.state === 'closing-arc-quadratic') && mode === 'cubic') {
      const state = {
        state: this.state.state === 'drawing-arc-quadratic' ? 'drawing-arc-cubic' : 'closing-arc-cubic',
        intersection: this.state.intersection,
        pointIndex: this.state.pointIndex,
        activeHandle: 'a',
        pendingStartPoint: this.state.pendingStartPoint,
        pendingControlPointA: this.state.pendingControlPoint,
        pendingControlPointB: midPoint(this.state.pendingStartPoint, this.state.pendingEndPoint),
        pendingEndPoint: this.state.pendingEndPoint,
      } satisfies PolygonToolState;
      this.setState(state);

      this.getGeometryStore().setWorkingPolygon((wp) => {
        if (!wp) {
          return null;
        }

        if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
          return {
            ...wp,
            points: [
              wp.points[0],
              {
                type: 'arc-cubic',
                point: wp.points[1].point,
                controlPointA: state.pendingControlPointA,
                controlPointB: state.pendingControlPointB,
              },
              ...wp.points.slice(2),
            ],
          };
        } else {
          return {
            ...wp,
            points: [
              ...wp.points.slice(0, -1),
              {
                type: 'arc-cubic',
                point: wp.points.at(-1)!.point,
                controlPointA: state.pendingControlPointA,
                controlPointB: state.pendingControlPointB,
              },
            ],
          };
        }
      });
      return;
    }

    if ((this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic') && mode === 'quadratic') {
      const state = {
        state: this.state.state === 'drawing-arc-cubic' ? 'drawing-arc-quadratic' : 'closing-arc-quadratic',
        intersection: this.state.intersection,
        pointIndex: this.state.pointIndex,
        pendingStartPoint: this.state.pendingStartPoint,
        pendingControlPoint: this.state.pendingControlPointA,
        pendingEndPoint: this.state.pendingEndPoint,
      } satisfies PolygonToolState;
      this.setState(state);

      this.getGeometryStore().setWorkingPolygon((wp) => {
        if (!wp) {
          return null;
        }

        if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
          return {
            ...wp,
            points: [
              wp.points[0],
              {
                type: 'arc-quadratic',
                point: wp.points[1].point,
                controlPoint: state.pendingControlPoint,
              },
              ...wp.points.slice(2),
            ],
          };
        } else {
          return {
            ...wp,
            points: [
              ...wp.points.slice(0, -1),
              {
                type: 'arc-quadratic',
                point: wp.points.at(-1)!.point,
                controlPoint: state.pendingControlPoint,
              },
            ],
          };
        }
      });
      return;
    }
  }

  /** Converts all working constraints with a length to permanent LinearConstraint
   *  objects locked to the given polygon's point indices. Only constraints with
   *  non-null constrainedLength are converted. The index maps each constraint to
   *  polygon point [i] -> [i+1]. */
  private commitConstraints(polygonId: Id): void {
    const wcs = this.getGeometryStore().workingConstraints;
    const store = this.getGeometryStore();
    let pointIndex = 0;
    for (const wc of wcs) {
      if (wc.type !== 'linear' || !wc.constrainedLength) {
        pointIndex += 1;
        continue;
      }
      store.addConstraint(LinearConstraint.create(
        ConstraintEndpoint.lockedToPolygon(polygonId, pointIndex),
        ConstraintEndpoint.lockedToPolygon(polygonId, pointIndex + 1),
        wc.constrainedLength,
        { connectorLineOffsetPx: wc.connectorLineOffsetPx },
      ));
      pointIndex += 1;
    }
  }

  /** Completes the working polygon and adds it to the store. */
  private completePolygon(wp: WorkingPolygon, closed: boolean, keepPreviewPoint: boolean = false) {
    let pointsCopy = wp.points.slice();
    if (!keepPreviewPoint) {
      if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
        pointsCopy = wp.points.slice(1);
      } else {
        pointsCopy = wp.points.slice(0, -1);
      }
    }

    // Don't complete polygon when it doesn't have at least 2 points
    if (pointsCopy.length < 2) {
      return wp;
    }

    const historyManager = this.getHistoryManager();
    const geometryStore = this.getGeometryStore();
    const source = wp.source;

    // FIXME: get rid of the transaction if there's no constraints to commit alongside the polygon
    historyManager.applyTransaction(`${source.type === 'existing-polygon' ? 'extend' : 'create'}-polygon-with-constraints`, () => {
      let polygonId;
      if (source.type === 'existing-polygon') {
        polygonId = source.polygonId;
        geometryStore.updatePolygon(source.polygonId, { points: pointsCopy, closed });
      } else {
        const polygon = geometryStore.addPolygon({
          points: pointsCopy,
          closed,
          fillColor: DEFAULT_COLOR,
          openAtIndex: 0,
        });
        polygonId = polygon.id;
      }

      let constraintIndex = -1;
      for (let pointIndex = 0; pointIndex < pointsCopy.length; pointIndex += 1) {
        // Make sure that a user actually entered a constraint value for this point
        const len = this.constrainedLengths[pointIndex];
        if (!len) {
          continue;
        }

        constraintIndex += 1;
        const wc = geometryStore.workingConstraints[constraintIndex];
        if (!wc) {
          continue;
        }

        geometryStore.addConstraint(LinearConstraint.create(
          ConstraintEndpoint.lockedToPolygon(polygonId, pointIndex),
          ConstraintEndpoint.lockedToPolygon(polygonId, pointIndex + 1),
          len,
          { connectorLineOffsetPx: wc.connectorLineOffsetPx },
        ));
      }
    });

    // Clean up working constraints and event subscription
    geometryStore.clearWorkingConstraints();
    geometryStore.off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
    this.constrainedLengths = [];

    // Reset state - user can now draw another polygon from scratch
    this.setState(INITIAL);
    return null;
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    switch (this.state.state) {
      case "idle":
      case "drawing-line": {
        const store = this.getGeometryStore();
        this.setState(INITIAL);
        store.setWorkingPolygon(null);
        store.clearWorkingConstraints();
        store.off('workingConstraintsChanged', this.handleWorkingConstraintsChanged);
        this.constrainedLengths = [];
        break;
      }

      case "closing-arc-quadratic":
      case "closing-arc-cubic":
      case "drawing-arc-quadratic":
      case "drawing-arc-cubic":
        this.clearLastPolygonSegment();
        break;
    }
  }

  /** Removes the last segment from the working polygon. */
  private clearLastPolygonSegment(): void {
    const state = this.state;
    this.getGeometryStore().setWorkingPolygon((wp) => {
      if (!wp) {
        return null;
      }

      switch (state.state) {
        case "drawing-arc-quadratic":
        case "drawing-arc-cubic":
        case "closing-arc-quadratic":
        case "closing-arc-cubic":
          const mousePoint = state.state === 'drawing-arc-quadratic' || state.state === 'closing-arc-quadratic' ? (
            state.pendingControlPoint
          ) : state.pendingControlPointA;

          if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
            // Create a new active working constraint for the new preview segment
            this.constrainedLengths.unshift(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
            this.getGeometryStore().setWorkingConstraints((old) => [
              {
                type: "linear",
                pointA: { type: "point", point: mousePoint },
                pointB: { type: "point", point: wp.points[1].point },
                constrainedLength: null,
                connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                disabled: false,
                shadowsConstraintId: null,
              },
              ...old,
            ]);

            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: state.intersection,
              pointIndex: 0,
              pendingStartPoint: mousePoint,
              pendingEndPoint: wp.points[1].point,
            });
            return {
              ...wp,
              points: [
                { type: 'point', point: mousePoint },
                ...wp.points.slice(1),
              ],
            };
          } else {
            // Create a new active working constraint for the new preview segment
            this.constrainedLengths.push(null); // NOTE: this must be before setWorkingConstraints, otherwise handleWorkingConstraintsChanged will operate on the wrong index
            this.getGeometryStore().setWorkingConstraints((old) => [
              ...old,
              {
                type: "linear",
                pointA: { type: "point", point: wp.points.at(-2)!.point },
                pointB: { type: "point", point: mousePoint },
                constrainedLength: null,
                connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                disabled: false,
                shadowsConstraintId: null,
              },
            ]);

            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: state.intersection,
              pointIndex: state.pointIndex,
              pendingStartPoint: mousePoint,
              pendingEndPoint: wp.points.at(-2)!.point,
            });
            return {
              ...wp,
              points: [
                ...wp.points.slice(0, -1),
                { type: 'point', point: mousePoint },
              ],
            };
          }

        case "drawing-line": {
          if (wp.points.length <= 2) {
            // Don't make a polygon less than 2 points long
            return wp;
          }

          if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
            this.getGeometryStore().setWorkingConstraints((old) => {
              // Remove the preview segment length entry
              this.constrainedLengths.shift();

              // Remove the first constrained length entry (representing the preview segment)
              let newConstraints = old.slice(1);

              if (this.constrainedLengths[0] === null) {
                // Push new working constraint because the new end segment doesn't have a "preview segment"
                newConstraints.unshift({
                  type: "linear",
                  pointA: { type: "point", point: wp.points[0 /* the mouse position */].point },
                  pointB: { type: "point", point: wp.points[2 /* endpoint two segments back, skipping the deleted segment */].point },
                  constrainedLength: null,
                  connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                  disabled: false,
                  shadowsConstraintId: null,
                })
              } else {
                console.log('update');
                // The previous segment already had a constraint
                // So un disable it, and it becomes the new "preview segment" constraint
                newConstraints[0] = {
                  ...newConstraints[0],
                  disabled: false,
                  pointA: { type: "point", point: wp.points[0 /* the mouse position */].point },
                };
              }

              return newConstraints;
            });

            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: state.intersection,
              pointIndex: 0,
              pendingStartPoint: wp.points[1].point,
              pendingEndPoint: wp.points[1].point,
            });
            return {
              ...wp,
              points: [
                // The last "settled" segment is the new preview point
                { type: 'point', point: wp.points[0].point },
                ...wp.points.slice(2 /* 1 old preview point + last "settled" segment */),
              ],
            };
          } else {
            this.getGeometryStore().setWorkingConstraints((old) => {
              // Remove the preview segment length entry
              this.constrainedLengths.pop();

              // Remove the last constrained length entry (representing the preview segment)
              let newConstraints = old.slice(0, -1);

              if (this.constrainedLengths.at(-1) === null) {
                // Push new working constraint because the new end segment doesn't have a "preview segment"
                newConstraints.push({
                  type: "linear",
                  pointA: { type: "point", point: wp.points.at(-3 /* endpoint two segments back, skipping the deleted segment */)!.point },
                  pointB: { type: "point", point: wp.points.at(-1 /* the mouse position */ )!.point },
                  constrainedLength: null,
                  connectorLineOffsetPx: LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
                  disabled: false,
                  shadowsConstraintId: null,
                })
              } else {
                // The previous segment already had a constraint
                // So un disable it, and it becomes the new "preview segment" constraint
                newConstraints[newConstraints.length - 1] = {
                  ...newConstraints[newConstraints.length - 1],
                  disabled: false,
                  pointB: { type: "point", point: wp.points.at(-1 /* the mouse position */)!.point },
                };
              }

              return newConstraints;
            });

            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: state.intersection,
              pointIndex: state.pointIndex - 1,
              pendingStartPoint: wp.points.at(-1)!.point,
              pendingEndPoint: wp.points.at(-2)!.point,
            });
            return {
              ...wp,
              points: [
                ...wp.points.slice(0, -2 /* 1 old preview point + last "settled" segment */),
                // The last "settled" segment is the new preview point
                { type: 'point', point: wp.points.at(-1)!.point },
              ],
            };
          }
        }

        default:
          return wp;
      }
    });

    // const intersectionData = getStateIntersectionData(this.state);
    // if (intersectionData) {
    //   intersectionData.keyCombos.clear();
    //   intersectionData.intersections = [];
    // }
    // this.emit('previewSegmentIntersections', []);
  }

  /** Applies snapping to a sheet position (grid snap only). */
  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  /** Applies snapping with 45-degree angular snapping from the previous point. */
  private applySnappingLineSeries(pos: SheetPosition, prevPoint: SheetPosition): SheetPosition {
    const options: SnappingLineSeriesOptions = {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    };

    // When extending from the start, then the "preview segment" is at the start
    // Otherwise, it's at the end.
    const wp = this.getGeometryStore().workingPolygon;
    const index = wp?.source.type === "existing-polygon" && wp.source.isStartPoint ? 0 : -1;
    const lastConstrainedLength = this.constrainedLengths.at(index);

    if (lastConstrainedLength) {
      const sheet = this.getSheet();
      if (sheet) {
        options.exactDistance = lastConstrainedLength.toSheetUnits(sheet.defaultUnit).magnitude;
      }
    }
    return applySnappingLineSeries(pos, prevPoint, options);
  }
}

function intersectionsEqual(oldIntersections: IntersectionData["intersections"], newIntersections: IntersectionData["intersections"]) {
  return oldIntersections.length === newIntersections.length && oldIntersections.every((oldValue, index) => {
    const newValue = newIntersections[index];
    return (
      oldValue.intersectionPoint.x === newValue.intersectionPoint.x &&
      oldValue.intersectionPoint.y === newValue.intersectionPoint.y &&
      oldValue.otherId == newValue.otherId &&
      oldValue.segment.start.x === newValue.segment.start.x &&
      oldValue.segment.start.y === newValue.segment.start.y &&
      oldValue.segment.end.x === newValue.segment.end.x &&
      oldValue.segment.end.y === newValue.segment.end.y &&
      oldValue.otherSegmentIndex === newValue.otherSegmentIndex
    );
  });
}
