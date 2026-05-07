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

const INITIAL: PolygonToolState = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };

/** All possible states for the polygon tool. */
type PolygonToolState =
  | { state: 'idle'; isHoveringFirstHandle: boolean; source: WorkingPolygonSource}
  | { state: 'hovering-polygon-endpoint'; polygonId: Id; pointIndex: number; isStartPoint: boolean }
  | {
      /** Actively placing line segments. Transitions to 'hovering-auto-close-point' on auto-close-point hover. */
      state: 'drawing-line';
      isHoveringFirstHandle: boolean;
      altHeldOnFirstHandleHover: boolean;
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
  | { state: 'closing-arc-quadratic'; intersection: IntersectionData, pendingControlPoint: SheetPosition }
  | { state: 'closing-arc-cubic'; intersection: IntersectionData, pendingControlPointA: SheetPosition, pendingControlPointB: SheetPosition };

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

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  /** The current polygon tool state machine. */
  state: PolygonToolState = INITIAL;

  /** Tracks pending arc draw mode when not in an arc drawing state. */
  private _pendingArcDrawMode: 'quadratic' | 'cubic' = 'quadratic';

  /** Backward-compatible getter for arcDrawMode. */
  get arcDrawMode(): 'quadratic' | 'cubic' {
    if (this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic') {
      return 'cubic';
    }
    if (this.state.state === 'drawing-arc-quadratic' || this.state.state === 'closing-arc-quadratic') {
      return 'quadratic';
    }
    return this._pendingArcDrawMode;
  }

  /** Backward-compatible setter for arcDrawMode. */
  set arcDrawMode(value: 'quadratic' | 'cubic') {
    this._pendingArcDrawMode = value;
    this.setArcDrawMode(value);
  }

  /** Backward-compatible getter for isHoveringFirstHandle. */
  get isHoveringFirstHandle(): boolean {
    switch (this.state.state) {
      case 'idle':
        return this.state.isHoveringFirstHandle;
      case 'drawing-line':
      case 'hovering-auto-close-point':
        return this.state.isHoveringFirstHandle;
      default:
        return false;
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
      this.state = { state: 'hovering-polygon-endpoint', ...endpoint };
      this.emit('hoveringEndpointOfPolygonChange', endpoint);
    } else if (this.state.state === 'hovering-polygon-endpoint') {
      this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
      this.emit('hoveringEndpointOfPolygonChange', null);
    }
  }

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingPolygon();
    this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
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
          this.state = {
            state: 'drawing-line',
            isHoveringFirstHandle: false,
            altHeldOnFirstHandleHover: false,
            intersection: createEmptyIntersectionData(),
            pointIndex: 1,
            pendingStartPoint: snapped,
            pendingEndPoint: snapped,
          };
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
          if (!wp) {
            throw new Error('drawing-line: working polygon must be set.');
          }
          const sheetPos = worldPos.toSheet();
          const prevPoint = getWorkingLastPointInDrawOrder(wp);
          const snapped = this.applySnapping(sheetPos, prevPoint);

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
            this.state = {
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeldOnFirstHandleHover: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: 0,
              pendingStartPoint: snapped,
              pendingEndPoint: polygon.points[0].point,
            };

            pointsCopy = [{ type: 'point', point: snapped }, ...polygon.points];
          } else {
            this.state = {
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeldOnFirstHandleHover: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: polygon.points.length,
              pendingStartPoint: polygon.points.at(-1)!.point,
              pendingEndPoint: snapped,
            };

            pointsCopy = [...polygon.points, { type: 'point', point: snapped }];
          }

          return {
            points: polygon.points,
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

          if (this.toolManager.getAltHeld()) {
            // Alt held, so start a closing curve
            if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
              // User extending polygon from the start point, so add the next point to the front
              this.state = {
                state: 'drawing-arc-quadratic',
                intersection: this.state.intersection,
                pointIndex: 1,
                pendingStartPoint: snapped,
                pendingControlPoint: snapped,
                pendingEndPoint: wp.points[0].point,
              };
              return {
                ...wp,
                points: [
                  { type: 'point', point: snapped },
                  {
                    type: 'arc-quadratic',
                    controlPoint: snapped,
                    point: wp.points[0].point,
                  },
                  ...wp.points.slice(1),
                ],
              };
            } else {
              // All other cases - add point to the end.
              this.state = {
                state: 'drawing-arc-quadratic',
                intersection: this.state.intersection,
                pointIndex: wp.points.length-1,
                pendingStartPoint: wp.points.at(-1)!.point,
                pendingControlPoint: snapped,
                pendingEndPoint: snapped,
              };
              return {
                ...wp,
                points: [
                  // Remove the last "point" segment at the end which was being adjusted by user mouse movements
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

          // Alt not being held, so just add a regular line segment
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

        case 'hovering-auto-close-point': {
          if (!wp) {
            throw new Error('drawing-line: working polygon must be set.');
          }
          const sheetPos = worldPos.toSheet();
          const prevPoint = getWorkingLastPointInDrawOrder(wp);
          const snapped = this.applySnapping(sheetPos, prevPoint);

          if (this.toolManager.getAltHeld()) {
            // Alt held, so start a closing curve
            //
            // The closing curve starts by default as a bezier curve, but can be changed by a user
            // later if desired.
            this.state = {
              state: 'closing-arc-quadratic',
              intersection: this.state.intersection,
              pendingControlPoint: snapped,
            };
            return wp;
          } else {
            // Alt not held, so fully complete the polygon
            if (wp.source.type === 'existing-polygon') {
              let closedPolygonPoints: Array<PolygonSegment>;
              if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
                // User extending polygon from the start point, so close by adding a final point to
                // the start.
                closedPolygonPoints = [{ type: 'point', point: snapped }, ...wp.points];
              } else {
                // All other cases - close by adding point to the end.
                closedPolygonPoints = [...wp.points, { type: 'point', point: snapped }];
              }
              this.getGeometryStore().updatePolygon(wp.source.polygonId, {
                points: closedPolygonPoints,
                closed: true,
              });
            } else {
              this.getGeometryStore().addPolygon({
                points: [...wp.points, { type: 'point', point: snapped }],
                closed,
                fillColor: DEFAULT_COLOR,
              });
            }

            // Reset state - user can now draw another polygon from scratch
            this.state = INITIAL;
            return null;
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
            pointsCopy[this.state.pointIndex] = {
              type: 'arc-quadratic',
              controlPoint: snapped,
              point: this.state.pendingStartPoint,
            };

            pointsCopy.unshift({ type: 'point', point: snapped });
            this.state = {
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeldOnFirstHandleHover: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: 0,
              pendingStartPoint: snapped,
              pendingEndPoint: pointsCopy[this.state.pointIndex].point,
            };
          } else {
            // All other cases - close by adding point to the end.
            pointsCopy[this.state.pointIndex] = {
              type: 'arc-quadratic',
              controlPoint: snapped,
              point: this.state.pendingEndPoint,
            };

            pointsCopy.push({ type: 'point', point: snapped });
            this.state = {
              state: 'drawing-line',
              isHoveringFirstHandle: false,
              altHeldOnFirstHandleHover: false,
              intersection: createEmptyIntersectionData(),
              pointIndex: pointsCopy.length-1,
              pendingStartPoint: pointsCopy[this.state.pointIndex].point,
              pendingEndPoint: snapped,
            };
          }

          return { ...wp, points: pointsCopy };
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
    this.previewSheetPos = snapped;
    this.updatePreview(screenPos, viewport);
    this.computePreviewIntersectionWithOtherPolygons();

    return this.getGeometryStore().setWorkingPolygon((wp) => {
      switch (this.state.state) {
        case 'drawing-line': {
          if (!wp) {
            return null;
          }

          this.state = { ...this.state, pendingEndPoint: snapped };

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'point',
            point: snapped,
          };
          return { ...wp, points: pointsCopy };
        }

        case 'drawing-arc-quadratic': {
          if (!wp) {
            return null;
          }

          this.state = { ...this.state, pendingControlPoint: snapped };

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'arc-quadratic',
            controlPoint: snapped,
            point: pointsCopy[this.state.pointIndex].point,
          };

          return { ...wp, points: pointsCopy };
        }

        case 'drawing-arc-cubic': {
          if (!wp) {
            return null;
          }

          this.state = { ...this.state, pendingControlPointA: snapped };

          const pointsCopy = wp.points.slice();
          pointsCopy[this.state.pointIndex] = {
            type: 'arc-cubic',
            controlPointA: snapped,
            controlPointB: (pointsCopy[this.state.pointIndex] as CubicBezierSegment).controlPointB,
            point: pointsCopy[this.state.pointIndex].point,
          };

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
        this.state = { ...this.state, isHoveringFirstHandle: hovering };
        break;
    }
    // switch (this.state.state) {
    //   case 'idle':
    //     if (this.state.isHoveringFirstHandle !== hovering) {
    //       this.state = { state: 'idle', isHoveringFirstHandle: hovering, source: this.state.source };
    //       this.emit('hoveringFirstHandleChange', hovering);
    //     }
    //     return;

    //   case 'drawing-arc-quadratic':
    //   case 'drawing-arc-cubic':
    //     if (hovering) {
    //       const wp = this.getGeometryStore().workingPolygon;
    //       if (wp && wp.points.length >= 2) {
    //         this.getGeometryStore().setWorkingPolygon((wp) => {
    //           if (wp) {
    //             return { ...wp, pendingArcEndPoint: wp.points[0].point };
    //           } else {
    //             return null;
    //           }
    //         });
    //         const newState = this.state.state === 'drawing-arc-cubic' ? 'closing-arc-cubic' : 'closing-arc-quadratic';
    //         this.state = { state: newState, intersection: this.state.intersection };
    //         this.emit('hoveringFirstHandleChange', true);
    //       }
    //     }
    //     return;

    //   case 'drawing-line':
    //   case 'hovering-auto-close-point':
    //     if (hovering && !this.state.isHoveringFirstHandle) {
    //       const altHeld = this.toolManager.getAltHeld();
    //       this.state = {
    //         state: 'hovering-auto-close-point',
    //         isHoveringFirstHandle: true,
    //         altHeldOnFirstHandleHover: altHeld,
    //         intersection: this.state.intersection,
    //       };
    //       this.emit('hoveringFirstHandleChange', true);
    //     } else if (!hovering && this.state.isHoveringFirstHandle) {
    //       this.state = {
    //         state: 'drawing-line',
    //         isHoveringFirstHandle: false,
    //         altHeldOnFirstHandleHover: false,
    //         intersection: this.state.intersection,
    //       };
    //       this.emit('hoveringFirstHandleChange', false);
    //     }
    //     return;

    //   case 'closing-arc-quadratic':
    //   case 'closing-arc-cubic':
    //     return;

    //   case 'hovering-polygon-endpoint':
    //     return;
    // }
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    switch (this.state.state) {
      case 'hovering-auto-close-point':
        this.state = {
          state: 'drawing-line',
          isHoveringFirstHandle: false,
          altHeldOnFirstHandleHover: false,
          intersection: this.state.intersection,
        };
        break;
      case 'closing-arc-quadratic':
      case 'closing-arc-cubic':
        this.getGeometryStore().setWorkingPolygon((wp) => {
          if (wp) {
            return { ...wp, pendingArcEndPoint: null };
          } else {
            return null;
          }
        });
        const newState = this.state.state === 'closing-arc-cubic' ? 'drawing-arc-cubic' : 'drawing-arc-quadratic';
        this.state = { state: newState, intersection: this.state.intersection };
        break;
    }
    this.emit('hoveringFirstHandleChange', false);
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
    this._pendingArcDrawMode = 'quadratic';
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
    if (event.key === 'Escape') {
      this.abortPolygon();
    } else if (event.key === 'Backspace') {
      this.clearLastPolygonSegment();
    } else if (event.key === 'Enter') {
      this.completePolygon(false);
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

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    switch (this.state.state) {
      case 'drawing-arc-quadratic':
      case 'drawing-arc-cubic':
        this.state = {
          state: mode === 'cubic' ? 'drawing-arc-cubic' : 'drawing-arc-quadratic',
          intersection: this.state.intersection,
        };
        this.emit('arcDrawModeChange', mode);
        break;
      case 'closing-arc-quadratic':
      case 'closing-arc-cubic':
        this.state = {
          state: mode === 'cubic' ? 'closing-arc-cubic' : 'closing-arc-quadratic',
          intersection: this.state.intersection,
        };
        this.emit('arcDrawModeChange', mode);
        break;
      case 'idle':
      case 'drawing-line':
      case 'hovering-auto-close-point':
        const wp2 = this.getGeometryStore().workingPolygon;
        if (wp2 && wp2.pendingArcEndPoint !== null) {
          this.state = {
            state: mode === 'cubic' ? 'drawing-arc-cubic' : 'drawing-arc-quadratic',
            intersection: createEmptyIntersectionData(),
          };
          this.emit('arcDrawModeChange', mode);
        }
        break;
    }
  }

  /** Loads an existing non-closed polygon into the working state so the user can continue drawing
   * from one of its endpoints.
   * @param polygonId The id of the polygon to extend.
   * @param isStartPoint If true, the user clicked the start point and will prepend new points.
   *                     If false, the user clicked the end point and will append new points. */
  loadPolygonIntoWorking(polygonId: Id, isStartPoint: boolean): void {
    const polygon = this.getGeometryStore().getPolygonById(polygonId);
    if (!polygon || polygon.closed) {
      return;
    }

    const source: WorkingPolygonSource = {
      type: 'existing-polygon',
      polygonId,
      isStartPoint,
      autoClosePoint: isStartPoint ? polygon.points[polygon.points.length - 1].point : polygon.points[0].point,
    };

    this.state = {
      state: 'drawing-line',
      isHoveringFirstHandle: false,
      altHeldOnFirstHandleHover: false,
      intersection: createEmptyIntersectionData(),
    };

    this.getGeometryStore().setWorkingPolygon({
      points: polygon.points,
      previewPoint: null,
      pendingArcEndPoint: null,
      source,
    });
  }

  /** Completes the polygon at the first handle (arc-close or normal close). */
  completePolygonAtFirstHandle(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length < 2) {
      return;
    }

    switch (this.state.state) {
      case 'drawing-line':
      case 'hovering-auto-close-point': {
        if (this.state.altHeldOnFirstHandleHover) {
          this.getGeometryStore().setWorkingPolygon((wp) => {
            if (wp) {
              return { ...wp, pendingArcEndPoint: wp.points.at(-1)!.point };
            } else {
              return null;
            }
          });
          this.state = { state: 'drawing-arc-quadratic', intersection: this.state.intersection };
        } else {
          const pathStartPoint = wp.points[0].point;
          this.getGeometryStore().setWorkingPolygon((wp) => {
            if (wp) {
              return { ...wp, points: [...wp.points, { type: 'point', point: pathStartPoint }] };
            } else {
              return null;
            }
          });
          this.completePolygon(true);
        }
        break;
      }
    }

    this.setHoveringFirstHandle(false);
  }

  /** Adds a point or arc segment to the working polygon. @internal */
  addPoint(worldPos: WorldPosition): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      return;
    }

    const sheetPos = worldPos.toSheet();
    const prevPoint = getWorkingLastPointInDrawOrder(wp);

    const snapped = this.applySnapping(sheetPos, prevPoint);

    if (wp.pendingArcEndPoint !== null) {
      const [arcStart, arcEnd] = wp.source.type === 'existing-polygon' && wp.source.isStartPoint ? [wp.pendingArcEndPoint, prevPoint!] : [prevPoint!, wp.pendingArcEndPoint];
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic';
      if (isCubic) {
        const controlPointB = quadraticBezierControlFromMidpoint(arcStart, arcEnd, midPoint(arcStart, arcEnd));
        this.addSegmentToWorkingPolygon({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB }, arcStart);
      } else {
        this.addSegmentToWorkingPolygon({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped }, arcStart);
      }
      this.getGeometryStore().setWorkingPolygon((old) => {
        if (old) {
          return { ...old, pendingArcEndPoint: null };
        } else {
          return null;
        }
      });

      const intersectionData = getStateIntersectionData(this.state);
      if (intersectionData) {
        intersectionData.lastSegmentHadEnabledIntersections = intersectionData.enabledKeyCombos.size > 0;
      }

      // Use autoClosePoint for arc auto-close detection
      const autoCloseCheck = wp.source.type === 'existing-polygon' ? wp.source.autoClosePoint : wp.points[0].point;
      console.log("CLOSED?", arcEnd, autoCloseCheck);
      if (arcEnd.x === autoCloseCheck.x && arcEnd.y === autoCloseCheck.y) {
        this.completePolygon(true);
        return;
      }

      this.state = {
        state: 'drawing-line',
        isHoveringFirstHandle: false,
        altHeldOnFirstHandleHover: false,
        intersection: createEmptyIntersectionData(),
      };
      return;
    } else if (this.toolManager.getAltHeld()) {
      this.getGeometryStore().setWorkingPolygon((old) => {
        if (old) {
          return { ...old, pendingArcEndPoint: snapped };
        } else {
          return null;
        }
      });
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic' || this._pendingArcDrawMode === 'cubic';
      this.state = {
        state: isCubic ? 'drawing-arc-cubic' : 'drawing-arc-quadratic',
        intersection: createEmptyIntersectionData(),
      };
      return;
    }

    const intersectionData = getStateIntersectionData(this.state);
    if (intersectionData) {
      intersectionData.lastSegmentHadEnabledIntersections = intersectionData.enabledKeyCombos.size > 0;
    }

    const convertedShapeIds = new Map<string, string>();
    if (intersectionData) {
      for (const inters of intersectionData.intersections) {
        if (intersectionData.enabledKeyCombos.has(inters.keyCombo)) {
          this.addSegmentToWorkingPolygon({ type: 'point', point: inters.intersectionPoint });

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

          console.log('INTERSECTION', inters);
          if ('controlPoint' in inters.segment) {
            const [leftCurve, rightCurve] = DeCasteljau.splitQuadraticBezier(inters.segment, inters.splitRatio);
            this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
              const points = old.points.slice();
              points.splice(
                inters.otherSegmentIndex,
                1,
                { type: 'arc-quadratic', point: leftCurve.end, controlPoint: leftCurve.controlPoint },
                { type: 'arc-quadratic', point: rightCurve.end, controlPoint: rightCurve.controlPoint },
              );
              return { ...old, points };
            });

          } else if ('controlPointA' in inters.segment && 'controlPointB' in inters.segment) {
            const [leftCurve, rightCurve] = DeCasteljau.splitCubicBezier(inters.segment, inters.splitRatio);
            this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
              const points = old.points.slice();
              points.splice(
                inters.otherSegmentIndex,
                1,
                { type: 'arc-cubic', point: leftCurve.end, controlPointA: leftCurve.controlPointA, controlPointB: leftCurve.controlPointB },
                { type: 'arc-cubic', point: rightCurve.end, controlPointA: rightCurve.controlPointA, controlPointB: rightCurve.controlPointB },
              );
              return { ...old, points };
            });

          } else {
            this.getGeometryStore().updatePolygon(otherPolygonId, (old) => {
              const points = old.points.slice();
              points.splice(inters.otherSegmentIndex, 0, { type: 'point', point: inters.intersectionPoint });
              return { ...old, points };
            });
          }
        }
      }
    }

    this.addSegmentToWorkingPolygon({ type: 'point', point: snapped });
  }

  /** Adds a segment to the working polygon. When extending from the start point of an existing
   * polygon, new points are prepended (unshift); otherwise they are appended (push).
   * For extend-from-start mode, manages placeholder points for correct preview line direction.
   * @param segment The segment to add to the working polygon.
   */
  private addSegmentToWorkingPolygon(segment: PolygonSegment, placeholderPoint?: SheetPosition): void {
    return this.getGeometryStore().setWorkingPolygon((wp) => {
      if (!wp) {
        return null;
      }
      const wpLastPointIsArc = wp.points[wp.points.length - 1].type !== "point";
      console.log('ADD POINT', wpLastPointIsArc)

      const wpPoints = wp.points.slice();
      if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
        if (wpLastPointIsArc) {
          // Remove "placeholder" point after arcs
          wpPoints.shift();
        }
        wpPoints.unshift(segment);
        if (segment.type !== 'point') {
          if (!placeholderPoint) {
            throw new Error('placeholder point needed but not passed')
          }
          // Add a palceholder point if the newly added segment is an arc
          wpPoints.unshift({ type: 'point', point: placeholderPoint });
        }
      } else {
        wpPoints.push(segment);
      }

      console.log('POINTS', wpPoints);
      return { ...wp, points: wpPoints };
    });
  }

  /** Updates the preview point on the working polygon. */
  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const prevPoint = getWorkingLastPointInDrawOrder(wp);
    const snapped = this.applySnapping(sheetPos, prevPoint);

    this.getGeometryStore().setWorkingPolygon({
      ...wp,
      previewPoint: snapped,
    });
  }

  /** Completes the working polygon and adds it to the store. */
  private completePolygon(closed: boolean): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp || wp.points.length < 2) {
      this.getGeometryStore().clearWorkingPolygon();
      this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
      return;
    }

    if (wp.source.type === 'existing-polygon') {
      let pointsToSave = wp.points.slice();

      // When extending from start and completing without closing, handle placeholder
      if (wp.source.isStartPoint && !closed) {
        // Check if the last segment (before placeholder at index 0) is an arc
        const lastSegmentType = wp.points[1]?.type;
        if (lastSegmentType === 'arc-quadratic' || lastSegmentType === 'arc-cubic') {
          // Keep placeholder for arc segment - do nothing
        } else {
          // Remove placeholder at index 0 for non-arc segments
          // wp.points.shift();
          pointsToSave = wp.points;
        }
      }

      // For non-closed completion with existing polygon, remove the duplicate closing segment
      // (completePolygonAtFirstHandle added a duplicate of the first point to close the visual path)
      let finalPoints = pointsToSave;
      if (!closed && wp.source.type === 'existing-polygon') {
        // Check if the last point is the same as the first point (duplicate from closing)
        if (finalPoints.length >= 2) {
          const firstPoint = finalPoints[0].point;
          const lastPoint = finalPoints[finalPoints.length - 1].point;
          if (firstPoint.x === lastPoint.x && firstPoint.y === lastPoint.y) {
            finalPoints = finalPoints.slice(0, -1);
          }
        }
      }

      this.getGeometryStore().updatePolygon(wp.source.polygonId, {
        points: finalPoints,
        closed,
      });

      this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
    } else {
      this.getGeometryStore().addPolygon({
        points: wp.points,
        closed,
        fillColor: DEFAULT_COLOR,
      });
      this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
    }

    this.getGeometryStore().clearWorkingPolygon();
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic';
      this.state = {
        state: isCubic ? 'drawing-arc-cubic' : 'drawing-arc-quadratic',
        intersection: createEmptyIntersectionData(),
      };
    } else {
      this.getGeometryStore().clearWorkingPolygon();
      this.state = { state: 'idle', isHoveringFirstHandle: false, source: { type: 'empty' } };
    }

    const intersectionData = getStateIntersectionData(this.state);
    if (intersectionData) {
      intersectionData.keyCombos.clear();
      intersectionData.intersections = [];
    }
    this.emit('previewSegmentIntersections', []);
  }

  /** Removes the last segment from the working polygon. */
  private clearLastPolygonSegment(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length <= 1 || wp.pendingArcEndPoint !== null) {
      this.abortPolygon();
      return;
    }

    if (wp.source.type === 'existing-polygon' && wp.source.isStartPoint) {
      // When extending from start, points are prepended with placeholder
      // So we remove from index 0 and 1 (placeholder and segment)
      this.getGeometryStore().setWorkingPolygon({
        ...wp,
        points: wp.points.slice(2),
      });
    } else {
      this.getGeometryStore().setWorkingPolygon({
        ...wp,
        points: wp.points.slice(0, -1),
      });
    }
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
