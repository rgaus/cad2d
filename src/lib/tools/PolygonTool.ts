import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState, LineSegment, QuadraticCurve, CubicCurve, Rect } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint, CohenSutherland, lineSegmentBoundingBox, Intersection, distance, DeCasteljau, boundingBox } from '../math';
import { BaseTool } from './BaseTool';
import { CubicBezierSegment, Id, WorkingPolygon, WorkingPolygonSource, type PolygonSegment } from './types';
import { KeyComboDetector, mapIndexToKeyCombo, type KeyCombo } from '../index-mapper';
import { DEFAULT_COLOR } from './GeometryStore';

export type PolygonToolEndpoint = {
  polygonId: Id;
  pointIndex: number;
  isStartPoint: boolean;
};

/** Events emitted by PolygonTool. */
export type PolygonToolEvents = {
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
  previewSegmentIntersections: (intersections: Array<PreviewSegmentIntersections>) => void;
  previewSegmentIntersectionsEnabled: (enabled: Set<KeyCombo>) => void;
  hoveringEndpointOfPolygonChange: (endpoint: PolygonToolEndpoint | null) => void;

  statusTooltipChange: (status: PolygonToolStatusTooltip) => void;
  previewSheetPositionChange: (pos: SheetPosition | null) => void;
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

/** Gets the anchor point for preview line drawing (where the line starts from).
 * When extending from start of existing polygon with a placeholder at index 0,
 * returns points[2] (the original first point of the polygon).
 * When extending from start with only 2 points (no placeholder yet), returns points[0].
 * Otherwise returns points.at(-1). */
function getPreviewAnchorPoint(state: PolygonToolState, workingPolygon: WorkingPolygon): SheetPosition | null {
  // if (!workingPolygon) {
  //   return workingPolygon.points.at(-1)?.point ?? null;
  // }
  const source = workingPolygon.source;
  if (source.type === 'existing-polygon' && source.isStartPoint && workingPolygon.points.length > 2) {
    // With placeholder: [placeholder, segment_to_X, A, B] -> return A (index 2)
    return workingPolygon.points[2].point;
  }
  if (source.type === 'existing-polygon' && source.isStartPoint && workingPolygon.points.length === 2) {
    // Before first click: [A, B] -> return A (index 0)
    return workingPolygon.points[0].point;
  }
  return workingPolygon.points.at(-1)?.point ?? null;
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

  /** The current polygon tool state machine. */
  state: PolygonToolState = INITIAL;

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
      this.emit('hoveringEndpointOfPolygonChange', endpoint);
    } else if (this.state.state === 'hovering-polygon-endpoint') {
      this.setState({ state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } });
      this.emit('hoveringEndpointOfPolygonChange', null);
    }
  }

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingPolygon();
    this.setState({ state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } });
    this.emit('previewSegmentIntersections', []);
    this.emit('previewSegmentIntersectionsEnabled', new Set());
  }

  /** Handles a click in the polygon tool. */
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState) {
    const worldPos = screenPos.toWorld(viewport);

    return this.getGeometryStore().setWorkingPolygon((wp) => {
      switch (this.state.state) {
        case 'idle':
          const sheetPos = worldPos.toSheet();
          const snapped = this.applySnapping(sheetPos, null);
          this.setState({
            state: 'drawing-line',
            isHoveringFirstHandle: false,
            altHeld: false,
            intersection: createEmptyIntersectionData(),
            pointIndex: 1,
            pendingStartPoint: snapped,
            pendingEndPoint: snapped,
          });
          return {
            points: [
              { type: 'point', point: snapped },
              { type: 'point', point: snapped },
            ],
            previewPoint: snapped,
            pendingArcEndPoint: null,
            source: { type: 'empty' },
          };

        case 'hovering-polygon-endpoint': {
          const sheetPos = worldPos.toSheet();
          const snapped = this.applySnapping(sheetPos, null);

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

          let pointsCopy: Array<PolygonSegment>;
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
          }

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
          const prevPoint = getWorkingLastPointInDrawOrder(wp);
          const snapped = this.applySnapping(sheetPos, prevPoint);

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

          // User hovering closing handle, so a click means "close the polygon"
          if (this.state.isHoveringFirstHandle) {
            // Alt not held, so fully complete the polygon
            if (wp.source.type === 'existing-polygon') {
              let closedPolygonPoints: Array<PolygonSegment>;
              if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
                // User extending polygon from the start point, so close by making the first point
                // equail to the pre-existing last point.
                closedPolygonPoints = [{ type: 'point', point: wp.points.at(-1)!.point }, ...wp.points.slice(1)];
              } else {
                // All other cases - close by making the last point == first point
                closedPolygonPoints = [...wp.points.slice(0, -1), { type: 'point', point: wp.points[0].point }];
              }
              this.getGeometryStore().updatePolygon(wp.source.polygonId, {
                points: closedPolygonPoints,
                closed: true,
              });
            } else {
              this.getGeometryStore().addPolygon({
                points: [...wp.points.slice(0, -1), { type: 'point', point: wp.points[0].point }],
                closed: true,
                fillColor: DEFAULT_COLOR,
              });
            }

            // Reset state - user can now draw another polygon from scratch
            this.setState(INITIAL);
            return null;
          }

          // Default case - just extend the polygon:
          if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
            // User extending polygon from the start point, so add the next point to the front
            this.state.pointIndex = 0;
            return { ...wp, points: [{ type: 'point', point: snapped }, ...wp.points] };
          } else {
            this.state.pointIndex += 1;
            // All other cases - add point to the end.
            return { ...wp, points: [...wp.points, { type: 'point', point: snapped }] };
          }
        }

        case 'drawing-arc-quadratic':
        case 'drawing-arc-cubic': {
          if (!wp) {
            throw new Error('drawing-line: working polygon must be set.');
          }
          const sheetPos = worldPos.toSheet();
          const prevPoint = getWorkingLastPointInDrawOrder(wp);
          const snapped = this.applySnapping(sheetPos, prevPoint);

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
              this.setState({
                state: 'drawing-line',
                isHoveringFirstHandle: false,
                altHeld: false,
                intersection: createEmptyIntersectionData(),
                pointIndex: 0,
                pendingStartPoint: snapped,
                pendingEndPoint: pointsCopy[this.state.pointIndex].point,
              });
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
              this.setState({
                state: 'drawing-line',
                isHoveringFirstHandle: false,
                altHeld: false,
                intersection: createEmptyIntersectionData(),
                pointIndex: pointsCopy.length-1,
                pendingStartPoint: pointsCopy[this.state.pointIndex].point,
                pendingEndPoint: snapped,
              });
            }
          }

          return { ...wp, points: pointsCopy };
        }

        case 'closing-arc-quadratic':
        case 'closing-arc-cubic': {
          if (!wp) {
            throw new Error('closing-arc-quadratic: working polygon must be set.');
          }

          if (this.state.state === 'closing-arc-cubic' && this.state.activeHandle === 'a') {
            // Cubic has two points to place, so after placing the first, switch the active handle
            // so the user can place the second one
            this.setState({ ...this.state, activeHandle: 'b' });
            return wp;
          } else {
            return this.completePolygon(wp, true, true /* keep preview point, this is the final arc */);
          }
        }

        default:
          return wp;
      }
    });
  }

  /** Handles mouse move. In polygon mode, updates preview snapping. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState) {
    // console.log('SOURCE', this.state, this.getGeometryStore().workingPolygon);
    const snapped = this.computePreviewSnappedPos(screenPos, viewport);
    this.computePreviewIntersectionWithOtherPolygons();

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

  private getPreviewSegment(): {
    segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
    boundingBox: Rect<SheetPosition>,
  } | null {
    const workingPolygon = this.getGeometryStore().workingPolygon;
    if (!workingPolygon) {
      return null;
    }

    const anchorPoint = getPreviewAnchorPoint(this.state, workingPolygon);
    if (!workingPolygon.previewPoint || !anchorPoint) {
      return null;
    }

    if (workingPolygon.pendingArcEndPoint) {
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic';
      if (isCubic) {
        const controlPointA = workingPolygon.previewPoint;
        const controlPointB = quadraticBezierControlFromMidpoint(
          anchorPoint,
          workingPolygon.pendingArcEndPoint,
          midPoint(anchorPoint, workingPolygon.pendingArcEndPoint),
        );

        const curve: CubicCurve<SheetPosition> = {
          start: anchorPoint,
          controlPointA,
          controlPointB,
          end: workingPolygon.pendingArcEndPoint,
        };
        return {
          segment: curve,
          boundingBox: boundingBox([curve.start, curve.end, curve.controlPointA, curve.controlPointB]),
        };
      } else {
        const curve: QuadraticCurve<SheetPosition> = {
          start: anchorPoint,
          controlPoint: workingPolygon.previewPoint,
          end: workingPolygon.pendingArcEndPoint,
        };
        return {
          segment: curve,
          boundingBox: boundingBox([curve.start, curve.end, curve.controlPoint]),
        };
      }
    } else {
      // Line mode - FROM anchorPoint TO previewPoint (correct direction)
      const segment: LineSegment<SheetPosition> = {
        start: anchorPoint,
        end: workingPolygon.previewPoint,
      };
      const boundingBox = lineSegmentBoundingBox(segment);

      return { segment, boundingBox };
    }
  }

  /** Computes intersection points between the preview segment and other polygons. */
  private computePreviewIntersectionWithOtherPolygons() {
    const previewSegment = this.getPreviewSegment();
    if (!previewSegment) {
      return;
    }
    const intersectionData = getStateIntersectionData(this.state);
    if (!intersectionData) {
      return;
    }

    const {
      segment: previewLineSegment,
      boundingBox: previewLineSegmentBoundingBox,
    } = previewSegment;
    const workingPolygonLastPoint = previewLineSegment.end;

    const oldIntersections = intersectionData.intersections;

    const previewSegmentIntersections: Array<PreviewSegmentIntersections> = [];
    for (const other of this.getGeometryStore().getAllGeometryAsSegments()) {
      const wp = this.getGeometryStore().workingPolygon;
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
            previewLineSegmentBoundingBox
          );
        } else if ('controlPointA' in otherSegment && 'controlPointB' in otherSegment) {
          mightIntersect = CohenSutherland.cubicCurveMightIntersectBoundingBox(
            otherSegment,
            previewLineSegmentBoundingBox
          );
        } else {
          mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(
            otherSegment,
            previewLineSegmentBoundingBox
          );
        }
        if (!mightIntersect) {
          continue;
        }

        const intersectionPointsSplitRatioPairs = Intersection.computeSegmentPairIntersections(
          previewLineSegment,
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

    intersectionData.intersections = previewSegmentIntersections.sort((a, b) => {
      return distance(workingPolygonLastPoint, a.intersectionPoint) - distance(workingPolygonLastPoint, b.intersectionPoint);
    }).map((inters, index) => ({
      ...inters,
      keyCombo: mapIndexToKeyCombo(index),
    }));

    const intersectingSegmentsUnchanged = oldIntersections.length === intersectionData.intersections.length && oldIntersections.every((oldValue, index) => {
      const newValue = intersectionData.intersections[index];
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
    if (!intersectingSegmentsUnchanged) {
      if (
        intersectionData.intersections.length === oldIntersections.length &&
        intersectionData.intersections.every((a, i) => a.keyCombo === oldIntersections[i]?.keyCombo)
      ) {
        intersectionData.keyCombos
          .clear()
          .setKeyCombos(intersectionData.intersections.map((inters) => inters.keyCombo));
        if (intersectionData.lastSegmentHadEnabledIntersections) {
          for (const i of intersectionData.intersections) {
            intersectionData.enabledKeyCombos.add(i.keyCombo);
          }
        } else {
          intersectionData.enabledKeyCombos.clear();
        }
        this.emit('previewSegmentIntersectionsEnabled', new Set(intersectionData.enabledKeyCombos.values()));
      }

      this.emit('previewSegmentIntersections', intersectionData.intersections);
    }
  }

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
  }

  /** Sets the first handle hover state, transitioning between drawing-line and closing states. */
  setHoveringFirstHandle(hovering: boolean): void {
    console.log('HOVERING', hovering)
    switch (this.state.state) {
      case "drawing-line":
        this.setState({ ...this.state, isHoveringFirstHandle: hovering });
        break;
    }
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.setState({ state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } });
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

  /** Computes the snapped position for the polygon tool preview. */
  computePreviewSnappedPos(screenPos: ScreenPosition, viewport: ViewportState): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    return applySnapping(sheetPos, null, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: false,
    });
  }

  /** Handles key down events for polygon drawing and select tool shortcuts. */
  handleKeyDown(event: KeyboardEvent) {
    if (this.state.state === 'drawing-line') {
      this.setState({ ...this.state, altHeld: this.toolManager.getAltHeld() });
    }

    if (event.key === 'Escape') {
      this.abortPolygon();
    } else if (event.key === 'Backspace') {
      this.clearLastPolygonSegment();
    } else if (event.key === 'Enter') {
      this.getGeometryStore().setWorkingPolygon((wp) => {
        if (wp) {
          return this.completePolygon(wp, false);
        } else {
          return null;
        }
      })
    } else if (event.key === 'b' || event.key === 'B') {
      this.setArcDrawMode('cubic');
    } else if (event.key === 'm' || event.key === 'M') {
      this.setArcDrawMode('quadratic');
    }

    const intersectionData = getStateIntersectionData(this.state);
    if (intersectionData) {
      if (event.key.length === 1 && event.key.charCodeAt(0) >= 97 && event.key.charCodeAt(0) <= 122) {
        const matchingKeyCombo = intersectionData.keyCombos.push(event.key);
        if (matchingKeyCombo !== null) {
          if (intersectionData.enabledKeyCombos.has(matchingKeyCombo)) {
            intersectionData.enabledKeyCombos.delete(matchingKeyCombo);
            intersectionData.lastSegmentHadEnabledIntersections = false;
          } else {
            intersectionData.enabledKeyCombos.add(matchingKeyCombo);
          }

          this.emit('previewSegmentIntersectionsEnabled', new Set(intersectionData.enabledKeyCombos.values()));
        }
      }
    }
  }

  handleKeyUp(_event: KeyboardEvent): void {
    if (this.state.state === 'drawing-line') {
      this.setState({ ...this.state, altHeld: this.toolManager.getAltHeld() });
    }
  }

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    console.log('STATE', this.state.state, mode);
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
      this.emit('arcDrawModeChange', mode);
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
      this.emit('arcDrawModeChange', mode);
      return;
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

    if (wp.source.type === 'existing-polygon') {
      this.getGeometryStore().updatePolygon(wp.source.polygonId, {
        points: pointsCopy,
        closed,
      });
    } else {
      this.getGeometryStore().addPolygon({
        points: pointsCopy,
        closed,
        fillColor: DEFAULT_COLOR,
      });
    }

    // Reset state - user can now draw another polygon from scratch
    this.setState(INITIAL);
    return null;
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    switch (this.state.state) {
      case "idle":
      case "drawing-line":
        this.setState(INITIAL);
        this.getGeometryStore().setWorkingPolygon(null);
        break;

      case "closing-arc-quadratic":
      case "closing-arc-cubic":
      case "drawing-arc-quadratic":
      case "drawing-arc-cubic":
        this.clearLastPolygonSegment();
        break;
    }

    // const intersectionData = getStateIntersectionData(this.state);
    // if (intersectionData) {
    //   intersectionData.keyCombos.clear();
    //   intersectionData.intersections = [];
    // }
    // this.emit('previewSegmentIntersections', []);
  }

  /** Removes the last segment from the working polygon. */
  private clearLastPolygonSegment(): void {
    const state = this.state;
    this.getGeometryStore().setWorkingPolygon((wp) => {
      if (!wp) {
        return null;
      }
      if (wp.points.length <= 2) {
        // Don't make a polygon less than 2 points long
        return wp;
      }

      switch (state.state) {
        case "drawing-arc-quadratic":
        case "drawing-arc-cubic":
        case "closing-arc-quadratic":
        case "closing-arc-cubic":
          if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
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
                {
                  type: 'point',
                  point: state.state === 'drawing-arc-quadratic' || state.state === 'closing-arc-quadratic' ? (
                    state.pendingControlPoint
                  ) : state.pendingControlPointA,
                },
                ...wp.points.slice(1)
              ],
            };
          } else {
            this.setState({
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeld: false,
              intersection: state.intersection,
              pointIndex: state.pointIndex,
              pendingStartPoint: wp.points.at(-1)!.point,
              pendingEndPoint: wp.points.at(-2)!.point,
            });
            return {
              ...wp,
              points: [
                ...wp.points.slice(0, -1),
                {
                  type: 'point',
                  point: state.state === 'drawing-arc-quadratic' || state.state === 'closing-arc-quadratic' ? (
                    state.pendingControlPoint
                  ) : state.pendingControlPointA,
                },
              ],
            };
          }

        case "drawing-line":
          if (wp.source.type === "existing-polygon" && wp.source.isStartPoint) {
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

  /** Applies snapping to a sheet position. */
  private applySnapping(pos: SheetPosition, prevPoint: SheetPosition | null): SheetPosition {
    return applySnapping(pos, prevPoint, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}
