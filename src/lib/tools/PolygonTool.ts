import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState, LineSegment, QuadraticCurve, CubicCurve, Rect } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint, CohenSutherland, lineSegmentBoundingBox, Intersection, distance, DeCasteljau, boundingBox } from '../math';
import { BaseTool } from './BaseTool';
import { Id } from './types';
import { KeyComboDetector, mapIndexToKeyCombo, type KeyCombo } from '../index-mapper';
import { DEFAULT_COLOR } from './GeometryStore';

/** Events emitted by PolygonTool. */
export type PolygonToolEvents = {
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
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
  /** Where along the segment the cplit occurred - the "t" value in DeCasteljau. */
  splitRatio: number;
};

/** Shared intersection tracking data used in drawing states. */
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

/** All possible states for the polygon tool. */
type PolygonToolState =
  | { state: 'idle' }
  | { state: 'drawing-line'; isHoveringFirstHandle: boolean; altHeldOnFirstHandleHover: boolean; intersection: IntersectionData }
  | { state: 'drawing-arc'; arcDrawMode: 'quadratic' | 'cubic'; intersection: IntersectionData }
  | { state: 'closing'; isHoveringFirstHandle: boolean; altHeldOnFirstHandleHover: boolean; intersection: IntersectionData }
  | { state: 'closing-arc'; arcDrawMode: 'quadratic' | 'cubic'; intersection: IntersectionData };

function getStateIntersectionData(state: PolygonToolState): IntersectionData | null {
  switch (state.state) {
    case 'drawing-line': return state.intersection;
    case 'drawing-arc': return state.intersection;
    case 'closing': return state.intersection;
    case 'closing-arc': return state.intersection;
    default: return null;
  }
}

function getStateArcDrawMode(state: PolygonToolState, pendingMode: 'quadratic' | 'cubic' = 'quadratic'): 'quadratic' | 'cubic' {
  switch (state.state) {
    case 'drawing-arc': return state.arcDrawMode;
    case 'closing-arc': return state.arcDrawMode;
    default: return pendingMode;
  }
}

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  /** The current polygon tool state machine. */
  state: PolygonToolState = { state: 'idle' };

  /** Tracks hover state for the idle state case where state doesn't have hover tracking. */
  private idleHoverState: boolean = false;

  /** Pending arc draw mode that will be used when entering arc drawing state. */
  private _pendingArcDrawMode: 'quadratic' | 'cubic' = 'quadratic';

  get pendingArcDrawMode(): 'quadratic' | 'cubic' {
    return this._pendingArcDrawMode;
  }

  set pendingArcDrawMode(value: 'quadratic' | 'cubic') {
    this._pendingArcDrawMode = value;
  }

  // Backward-compatible accessors for arcDrawMode
  get arcDrawMode(): 'quadratic' | 'cubic' {
    return getStateArcDrawMode(this.state, this.pendingArcDrawMode);
  }

  set arcDrawMode(value: 'quadratic' | 'cubic') {
    this.pendingArcDrawMode = value;
    if (this.state.state === 'drawing-arc') {
      this.state.arcDrawMode = value;
    } else if (this.state.state === 'closing-arc') {
      this.state.arcDrawMode = value;
    }
  }
  get isHoveringFirstHandle(): boolean {
    if (this.state.state === 'drawing-line') {
      return this.state.isHoveringFirstHandle;
    } else if (this.state.state === 'closing') {
      return this.state.isHoveringFirstHandle;
    }
    return false;
  }

  // Backward-compatible accessors for previewSegmentIntersections
  get previewSegmentIntersections(): Array<PreviewSegmentIntersections> {
    const data = getStateIntersectionData(this.state);
    return data ? data.intersections : [];
  }

  set previewSegmentIntersections(value: Array<PreviewSegmentIntersections>) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.intersections = value;
      data.keyCombos.clear().setKeyCombos(value.map(i => i.keyCombo));
    }
  }

  // Backward-compatible accessors for previewSegmentInteractionsKeyCombos
  get previewSegmentInteractionsKeyCombos(): KeyComboDetector {
    const data = getStateIntersectionData(this.state);
    return data ? data.keyCombos : new KeyComboDetector();
  }

  set previewSegmentInteractionsKeyCombos(value: KeyComboDetector) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.keyCombos = value;
    }
  }

  // Backward-compatible accessors for previewSegmentInteractionsEnabled
  get previewSegmentInteractionsEnabled(): Set<KeyCombo> {
    const data = getStateIntersectionData(this.state);
    return data ? data.enabledKeyCombos : new Set<KeyCombo>();
  }

  set previewSegmentInteractionsEnabled(value: Set<KeyCombo>) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.enabledKeyCombos = value;
    }
  }

  // Backward-compatible accessors for lastPreviewSegmentEnabledIntersections
  get lastPreviewSegmentEnabledIntersections(): boolean {
    const data = getStateIntersectionData(this.state);
    return data ? data.lastSegmentHadEnabledIntersections : false;
  }

  set lastPreviewSegmentEnabledIntersections(value: boolean) {
    const data = getStateIntersectionData(this.state);
    if (data) {
      data.lastSegmentHadEnabledIntersections = value;
    }
  }

  // Backward-compatible accessors for altHeldOnFirstHandleHover
  get altHeldOnFirstHandleHover(): boolean {
    if (this.state.state === 'drawing-line') {
      return this.state.altHeldOnFirstHandleHover;
    } else if (this.state.state === 'closing') {
      return this.state.altHeldOnFirstHandleHover;
    }
    return false;
  }

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingPolygon();
    this.state = { state: 'idle' };
    this.idleHoverState = false;
    this.emit('previewSegmentIntersections', []);
    this.emit('previewSegmentIntersectionsEnabled', new Set());
  }

  /** Handles a click in the polygon tool. */
  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState) {
    const worldPos = screenPos.toWorld(viewport);
    const wp = this.getGeometryStore().workingPolygon;

    if (!wp) {
      if (this.previewSheetPos) {
        this.getGeometryStore().setWorkingPolygon({
          points: [{ type: 'point', point: this.previewSheetPos }],
          previewPoint: null,
          pendingArcEndPoint: null,
        });
        if (this.state.state === 'drawing-arc' || this.state.state === 'closing-arc') {
        } else {
          this.state = {
            state: 'drawing-line',
            isHoveringFirstHandle: false,
            altHeldOnFirstHandleHover: false,
            intersection: createEmptyIntersectionData(),
          };
        }
      }
      return;
    }

    this.addPoint(worldPos);
  }

  /** Handles mouse move. In select mode, updates dragging during an active drag. */
  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState) {
    this.previewSheetPos = this.computePreviewSnappedPos(screenPos, viewport);
    this.updatePreview(screenPos, viewport);
    this.computePreviewIntersectionWithOtherPolygons();
  }

  private getPreviewSegment(): {
    segment: LineSegment<SheetPosition> | QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>,
    boundingBox: Rect<SheetPosition>,
  } | null {
    const workingPolygon = this.getGeometryStore().workingPolygon;
    if (!workingPolygon) {
      return null;
    }
    const workingPolygonLastPoint = workingPolygon.points.at(-1);
    if (!workingPolygon.previewPoint || !workingPolygonLastPoint || workingPolygonLastPoint.type !== 'point') {
      return null;
    }

    const arcDrawMode = this.getArcDrawMode();

    if (workingPolygon.pendingArcEndPoint) {
      if (arcDrawMode === 'cubic') {
          // FIXME: figure out how to make control point b settable in the polygon drawing workflow
        const controlPointA = workingPolygon.previewPoint;
        const controlPointB = quadraticBezierControlFromMidpoint(
          workingPolygonLastPoint.point,
          workingPolygon.pendingArcEndPoint,
          midPoint(workingPolygonLastPoint.point, workingPolygon.pendingArcEndPoint),
        );

        const curve: CubicCurve<SheetPosition> = {
          start: workingPolygonLastPoint.point,
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
          start: workingPolygonLastPoint.point,
          controlPoint: workingPolygon.previewPoint,
          end: workingPolygon.pendingArcEndPoint,
        };
        return {
          segment: curve,
          boundingBox: boundingBox([curve.start, curve.end, curve.controlPoint]),
        };
      }
    } else {
      const segment: LineSegment<SheetPosition> = {
        start: workingPolygon.previewPoint,
        end: workingPolygonLastPoint.point,
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
    const intersectionData = this.getCurrentIntersectionData();
    if (!intersectionData) {
      return;
    }

    const {
      segment: previewLineSegment,
      boundingBox: previewLineSegmentBoundingBox,
    } = previewSegment;
    const workingPolygonLastPoint = previewLineSegment.end;

    // Loop through all other polygons and get segments to check for intersections.
    const previewSegmentIntersections = [];
    for (const other of this.getGeometryStore().getAllGeometryAsSegments()) {
      for (const { index, segment: otherSegment } of other.segments) {
        if ('controlPoint' in otherSegment) {
          const mightIntersect = CohenSutherland.quadraticCurveMightIntersectBoundingBox(
            otherSegment,
            previewLineSegmentBoundingBox
          );
          if (!mightIntersect) {
            continue;
          }
        } else if ('controlPointA' in otherSegment && 'controlPointB' in otherSegment) {
          const mightIntersect = CohenSutherland.cubicCurveMightIntersectBoundingBox(
            otherSegment,
            previewLineSegmentBoundingBox
          );
          if (!mightIntersect) {
            continue;
          }
        } else {
          const mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(
            otherSegment,
            previewLineSegmentBoundingBox
          );
          if (!mightIntersect) {
            continue;
          }
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
          });
        }
      }
    }

    const oldIntersections = intersectionData.intersections;
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
        // FIXME: also check controlPoint / controlPointA / controlPointB here too!
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

  private getCurrentIntersectionData(): IntersectionData | null {
    if (this.state.state === 'drawing-line') {
      return this.state.intersection;
    } else if (this.state.state === 'closing') {
      return this.state.intersection;
    } else if (this.state.state === 'drawing-arc') {
      return this.state.intersection;
    } else if (this.state.state === 'closing-arc') {
      return this.state.intersection;
    }
    return null;
  }

  private getArcDrawMode(): 'quadratic' | 'cubic' {
    if (this.state.state === 'drawing-arc') {
      return this.state.arcDrawMode;
    } else if (this.state.state === 'closing-arc') {
      return this.state.arcDrawMode;
    }
    return 'quadratic';
  }

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
  }

  /** Sets the first handle hover state, transitioning between drawing-line and closing states. */
  setHoveringFirstHandle(hovering: boolean): void {
    if (this.state.state === 'idle') {
      if (this.idleHoverState !== hovering) {
        this.idleHoverState = hovering;
        this.emit('hoveringFirstHandleChange', hovering);
      }
      return;
    }

    if (this.state.state === 'drawing-arc' || this.state.state === 'closing-arc') {
      const wp = this.getGeometryStore().workingPolygon;
      if (wp && wp.points.length >= 2) {
        const altHeld = this.toolManager.getAltHeld();
        wp.pendingArcEndPoint = wp.points[0].point;
        this.getGeometryStore().setWorkingPolygon({ ...wp });
        this.state = {
          state: 'closing-arc',
          arcDrawMode: this.state.arcDrawMode,
          intersection: this.state.intersection,
        };
        this.emit('hoveringFirstHandleChange', true);
      }
      return;
    }

    const drawingLineState = this.state.state === 'drawing-line' || this.state.state === 'closing' ? this.state : null;
    if (!drawingLineState || drawingLineState.isHoveringFirstHandle) {
      return;
    }

    const altHeld = this.toolManager.getAltHeld();
    this.state = {
      state: 'closing',
      isHoveringFirstHandle: true,
      altHeldOnFirstHandleHover: altHeld,
      intersection: drawingLineState.intersection,
    };
    this.emit('hoveringFirstHandleChange', true);
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    if (this.state.state === 'closing') {
      this.state = {
        state: 'drawing-line',
        isHoveringFirstHandle: false,
        altHeldOnFirstHandleHover: false,
        intersection: this.state.intersection,
      };
    } else if (this.state.state === 'closing-arc') {
      const wp = this.getGeometryStore().workingPolygon;
      if (wp) {
        wp.pendingArcEndPoint = null;
        this.getGeometryStore().setWorkingPolygon({ ...wp });
      }
      const prevState = this.state;
      this.state = {
        state: 'drawing-arc',
        arcDrawMode: prevState.arcDrawMode,
        intersection: prevState.intersection,
      };
    }
    this.emit('hoveringFirstHandleChange', false);
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.state = { state: 'idle' };
    this.idleHoverState = false;
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

    const intersectionData = this.getCurrentIntersectionData();
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
    if (this.state.state === 'drawing-arc') {
      this.state.arcDrawMode = mode;
      this.emit('arcDrawModeChange', mode);
    } else if (this.state.state === 'closing-arc') {
      this.state.arcDrawMode = mode;
      this.emit('arcDrawModeChange', mode);
    } else if (this.state.state === 'idle' || this.state.state === 'drawing-line' || this.state.state === 'closing') {
      const wp = this.getGeometryStore().workingPolygon;
      if (wp && wp.pendingArcEndPoint !== null) {
        this.state = {
          state: 'drawing-arc',
          arcDrawMode: mode,
          intersection: createEmptyIntersectionData(),
        };
        this.emit('arcDrawModeChange', mode);
      }
    }
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

    if (this.state.state === 'closing') {
      if (this.state.altHeldOnFirstHandleHover) {
        wp.pendingArcEndPoint = wp.points[0].point;
        this.getGeometryStore().setWorkingPolygon({ ...wp });
        this.state = {
          state: 'drawing-arc',
          arcDrawMode: this.pendingArcDrawMode,
          intersection: this.state.intersection,
        };
      } else {
        wp.points.push(wp.points[0]);
        this.getGeometryStore().setWorkingPolygon({ ...wp });
        this.completePolygon(true);
      }
    } else if (this.state.state === 'closing-arc') {
      this.state = {
        state: 'drawing-arc',
        arcDrawMode: this.state.arcDrawMode,
        intersection: this.state.intersection,
      };
    } else {
      wp.points.push(wp.points[0]);
      this.getGeometryStore().setWorkingPolygon({ ...wp });
      this.completePolygon(true);
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
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;

    const snapped = this.applySnapping(sheetPos, prevPoint);

    if (wp.pendingArcEndPoint !== null) {
      const arcEnd = wp.pendingArcEndPoint;
      const arcDrawMode = this.arcDrawMode;
      console.log('[addPoint] pendingArcEndPoint not null, arcDrawMode:', arcDrawMode);
      if (arcDrawMode === 'quadratic') {
        wp.points.push({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped });
      } else {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB });
      }
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });

      const intersectionData = this.getCurrentIntersectionData();
      if (intersectionData) {
        intersectionData.lastSegmentHadEnabledIntersections = intersectionData.enabledKeyCombos.size > 0;
      }

      if (arcEnd.x === wp.points[0].point.x && arcEnd.y === wp.points[0].point.y) {
        this.completePolygon(true);
        return;
      }

      this.state = {
        state: 'drawing-line',
        isHoveringFirstHandle: false,
        altHeldOnFirstHandleHover: false,
        intersection: createEmptyIntersectionData(),
      };
      this.pendingArcDrawMode = this.getArcDrawMode();
      return;
    } else if (this.toolManager.getAltHeld()) {
      wp.pendingArcEndPoint = snapped;
      const mode = this.state.state === 'drawing-arc' || this.state.state === 'closing-arc' ? this.state.arcDrawMode : this.pendingArcDrawMode;
      this.state = {
        state: 'drawing-arc',
        arcDrawMode: mode,
        intersection: createEmptyIntersectionData(),
      };
      return;
    }

    const intersectionData = this.getCurrentIntersectionData();
    if (intersectionData) {
      intersectionData.lastSegmentHadEnabledIntersections = intersectionData.enabledKeyCombos.size > 0;
    }

    const convertedShapeIds = new Map<string, string>();
    if (intersectionData) {
      for (const inters of intersectionData.intersections) {
        if (intersectionData.enabledKeyCombos.has(inters.keyCombo)) {
          wp.points.push({ type: 'point', point: inters.intersectionPoint });

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

    wp.points.push({ type: 'point', point: snapped });
    this.getGeometryStore().setWorkingPolygon({ ...wp });
  }

  /** Updates the preview point on the working polygon. */
  private updatePreview(screenPos: ScreenPosition, viewport: ViewportState): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) return;

    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const prevSegment = wp.points.length > 0 ? wp.points[wp.points.length - 1] : null;
    const prevPoint = prevSegment ? prevSegment.point : null;
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
      this.state = { state: 'idle' };
      return;
    }

    this.getGeometryStore().addPolygon({
      points: wp.points,
      closed,
      fillColor: DEFAULT_COLOR,
    });
    this.getGeometryStore().clearWorkingPolygon();
    this.state = { state: 'idle' };
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });
      this.state = {
        state: 'drawing-arc',
        arcDrawMode: this.getArcDrawMode(),
        intersection: createEmptyIntersectionData(),
      };
    } else {
      this.getGeometryStore().clearWorkingPolygon();
      this.state = { state: 'idle' };
    }

    const intersectionData = this.getCurrentIntersectionData();
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

    this.getGeometryStore().setWorkingPolygon({
      ...wp,
      points: wp.points.slice(0, -1),
    });
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