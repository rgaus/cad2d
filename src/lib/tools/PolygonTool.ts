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

/** All possible states for the polygon tool. */
type PolygonToolState =
  | { state: 'idle'; isHoveringFirstHandle: boolean }
  | { 
      /** Actively placing line segments. Transitions to 'closing' on first handle hover. */
      state: 'drawing-line'; 
      isHoveringFirstHandle: boolean; 
      altHeldOnFirstHandleHover: boolean; 
      intersection: IntersectionData 
    }
  | { state: 'drawing-arc-quadratic'; intersection: IntersectionData }
  | { state: 'drawing-arc-cubic'; intersection: IntersectionData }
  | { 
      /** Mouse is hovering over first handle while in drawing-line state. */
      state: 'closing'; 
      isHoveringFirstHandle: boolean; 
      altHeldOnFirstHandleHover: boolean; 
      intersection: IntersectionData 
    }
  | { state: 'closing-arc-quadratic'; intersection: IntersectionData }
  | { state: 'closing-arc-cubic'; intersection: IntersectionData };

function getStateIntersectionData(state: PolygonToolState): IntersectionData | null {
  if (state.state === 'idle') {
    return null;
  }
  return state.intersection;
}

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  /** The current polygon tool state machine. */
  state: PolygonToolState = { state: 'idle', isHoveringFirstHandle: false };

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
      case 'closing':
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

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingPolygon();
    this.state = { state: 'idle', isHoveringFirstHandle: false };
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
        switch (this.state.state) {
          case 'drawing-arc-quadratic':
          case 'drawing-arc-cubic':
            break;
          default:
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

    if (workingPolygon.pendingArcEndPoint) {
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic';
      if (isCubic) {
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
            keyCombo: '', // Will be set in map below
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
    switch (this.state.state) {
      case 'idle':
        if (this.state.isHoveringFirstHandle !== hovering) {
          this.state = { state: 'idle', isHoveringFirstHandle: hovering };
          this.emit('hoveringFirstHandleChange', hovering);
        }
        return;

      case 'drawing-arc-quadratic':
      case 'drawing-arc-cubic':
        if (hovering) {
          const wp = this.getGeometryStore().workingPolygon;
          if (wp && wp.points.length >= 2) {
            wp.pendingArcEndPoint = wp.points[0].point;
            this.getGeometryStore().setWorkingPolygon({ ...wp });
            const newState = this.state.state === 'drawing-arc-cubic' ? 'closing-arc-cubic' : 'closing-arc-quadratic';
            this.state = { state: newState, intersection: this.state.intersection };
            this.emit('hoveringFirstHandleChange', true);
          }
        }
        return;

      case 'drawing-line':
      case 'closing':
        if (hovering && !this.state.isHoveringFirstHandle) {
          const altHeld = this.toolManager.getAltHeld();
          this.state = {
            state: 'closing',
            isHoveringFirstHandle: true,
            altHeldOnFirstHandleHover: altHeld,
            intersection: this.state.intersection,
          };
          this.emit('hoveringFirstHandleChange', true);
        } else if (!hovering && this.state.isHoveringFirstHandle) {
          this.state = {
            state: 'drawing-line',
            isHoveringFirstHandle: false,
            altHeldOnFirstHandleHover: false,
            intersection: this.state.intersection,
          };
          this.emit('hoveringFirstHandleChange', false);
        }
        return;

      case 'closing-arc-quadratic':
      case 'closing-arc-cubic':
        return;
    }
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    switch (this.state.state) {
      case 'closing':
        this.state = {
          state: 'drawing-line',
          isHoveringFirstHandle: false,
          altHeldOnFirstHandleHover: false,
          intersection: this.state.intersection,
        };
        break;
      case 'closing-arc-quadratic':
      case 'closing-arc-cubic':
        const wp = this.getGeometryStore().workingPolygon;
        if (wp) {
          wp.pendingArcEndPoint = null;
          this.getGeometryStore().setWorkingPolygon({ ...wp });
        }
        const newState = this.state.state === 'closing-arc-cubic' ? 'drawing-arc-cubic' : 'drawing-arc-quadratic';
        this.state = { state: newState, intersection: this.state.intersection };
        break;
    }
    this.emit('hoveringFirstHandleChange', false);
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.state = { state: 'idle', isHoveringFirstHandle: false };
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
      case 'closing':
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
      case 'closing':
        if (this.state.altHeldOnFirstHandleHover) {
          wp.pendingArcEndPoint = wp.points[0].point;
          this.getGeometryStore().setWorkingPolygon({ ...wp });
          this.state = { state: 'drawing-arc-quadratic', intersection: this.state.intersection };
        } else {
          wp.points.push(wp.points[0]);
          this.getGeometryStore().setWorkingPolygon({ ...wp });
          this.completePolygon(true);
        }
        break;
      case 'closing-arc-quadratic':
      case 'closing-arc-cubic': {
        const isCubic = this.state.state === 'closing-arc-cubic';
        this.state = {
          state: isCubic ? 'drawing-arc-cubic' : 'drawing-arc-quadratic',
          intersection: this.state.intersection,
        };
        break;
      }
      case 'drawing-line':
        wp.points.push(wp.points[0]);
        this.getGeometryStore().setWorkingPolygon({ ...wp });
        this.completePolygon(true);
        break;
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
      const isCubic = this.state.state === 'drawing-arc-cubic' || this.state.state === 'closing-arc-cubic';
      if (isCubic) {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB });
      } else {
        wp.points.push({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped });
      }
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });

      const intersectionData = getStateIntersectionData(this.state);
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
      return;
    } else if (this.toolManager.getAltHeld()) {
      wp.pendingArcEndPoint = snapped;
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
      this.state = { state: 'idle', isHoveringFirstHandle: false };
      return;
    }

    this.getGeometryStore().addPolygon({
      points: wp.points,
      closed,
      fillColor: DEFAULT_COLOR,
    });
    this.getGeometryStore().clearWorkingPolygon();
    this.state = { state: 'idle', isHoveringFirstHandle: false };
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
      this.state = { state: 'idle', isHoveringFirstHandle: false };
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
