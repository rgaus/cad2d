import { ScreenPosition, WorldPosition, SheetPosition, type ViewportState, LineSegment } from '../viewport/types';
import { getGridAtScale } from '../viewport/grid';
import { applySnapping, type SnappingOptions } from './SnappingCalculator';
import { quadraticBezierControlFromMidpoint, midPoint, CohenSutherland, lineSegmentBoundingBox, computeLineSegmentIntersection, distance } from '../math';
import { BaseTool } from './BaseTool';
import { Id } from './types';
import { KeyComboDetector, mapIndexToKeyCombo, type KeyCombo } from '../index-mapper';

/** Events emitted by SelectTool. */
export type PolygonToolEvents = {
  arcDrawModeChange: (mode: 'quadratic' | 'cubic') => void;
  hoveringFirstHandleChange: (hovering: boolean) => void;
  previewSegmentIntersections: (intersections: Array<PreviewSegmentIntersections>) => void;
  previewSegmentIntersectionsEnabled: (enabled: Set<KeyCombo>) => void;
};

export type PreviewSegmentIntersections = {
  otherPolygonId: Id;
  otherPolygonSegmentIndex: number;
  keyCombo: string;
  lineSegment: LineSegment<SheetPosition>;
  intersectionPoint: SheetPosition;
};

/** A tool for creating new polygons. */
export class PolygonTool extends BaseTool<PolygonToolEvents> {
  type = "polygon" as const;

  previewSheetPos: SheetPosition | null = null;

  /** The current arc drawing mode */
  public arcDrawMode: 'quadratic' | 'cubic' = 'quadratic';
  public isHoveringFirstHandle: boolean = false;
  /** Whether the Alt key was held at the moment the user started hovering the first handle. */
  private altHeldOnFirstHandleHover: boolean = false;

  /** When drawing a polygon, store if another itnersecting segment was found crossing the current
    * "working" segment being drawn. */
  public previewSegmentIntersections: Array<PreviewSegmentIntersections> = [];
  /** The {@link KeyComboDetector} which is used to detect intersection key combos. It is reset
    * after any this.previewSegmentIntersections update. */
  private previewSegmentInteractionsKeyCombos: KeyComboDetector = new KeyComboDetector();
  /** Has a user pressed the key combo for a given intersection to enable it? */
  private previewSegmentInteractionsEnabled = new Set<KeyCombo>();
  /** A flag indicating if last time the user clicks to place a preview segment, polygon
    * intersections were enabled. If they were, then enable them by default when placing the next
    * intersections. */
  private lastPreviewSegmentEnabledIntersections = false;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingPolygon();
    this.previewSegmentInteractionsKeyCombos.clear();
    this.previewSegmentInteractionsEnabled.clear();
    this.lastPreviewSegmentEnabledIntersections = false;
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

  /** Computes intersection points between the preview segment and other polygons. */
  private computePreviewIntersectionWithOtherPolygons() {
    const workingPolygon = this.getGeometryStore().workingPolygon;
    if (!workingPolygon) {
      return;
    }
    const workingPolygonLastPoint = workingPolygon.points.at(-1);
    if (!workingPolygon.previewPoint || !workingPolygonLastPoint || workingPolygonLastPoint.type !== 'point') {
      return;
    }

    const previewLineSegment: LineSegment<SheetPosition> = {
      start: workingPolygon.previewPoint,
      end: workingPolygonLastPoint.point,
    };
    const previewLineSegmentBoundingBox = lineSegmentBoundingBox(previewLineSegment);

    // Loop through all other polygons and get segments to check for intersections.
    const previewSegmentIntersections = [];
    for (const otherPolygon of this.getGeometryStore().polygons) {
      const otherPolygonSegments = [];
      let lastPoint = null;
      for (let index = 0; index <  otherPolygon.points.length; index += 1) {
        const seg = otherPolygon.points[index];
        if (seg.type === 'point' && lastPoint) {
          otherPolygonSegments.push({ index, segment: { start: lastPoint, end: seg.point }});
        }
        lastPoint = seg.point;
      }

      for (const { index, segment: otherSegment } of otherPolygonSegments) {
        const mightIntersect = CohenSutherland.lineSegmentMightIntersectBoundingBox(
          otherSegment,
          previewLineSegmentBoundingBox
        );
        if (!mightIntersect) {
          continue;
        }

        const intersectionPoint = computeLineSegmentIntersection(otherSegment, previewLineSegment);
        if (intersectionPoint) {
          previewSegmentIntersections.push({
            otherPolygonId: otherPolygon.id,
            otherPolygonSegmentIndex: index,
            lineSegment: otherSegment,
            intersectionPoint,
          });
        }
      }
    }

    const oldPreviewSegmentIntersections = this.previewSegmentIntersections;
    this.previewSegmentIntersections = previewSegmentIntersections.sort((a, b) => {
      // Order intersections from closest to final working polygon point -> furthest away.
      return distance(workingPolygonLastPoint.point, a.intersectionPoint) - distance(workingPolygonLastPoint.point, b.intersectionPoint);
    }).map((inters, index) => ({
      // Add the key combo AFTER sorting, so they are always in a stable order
      ...inters,
      keyCombo: mapIndexToKeyCombo(index),
    }));

    // If there were changes to the intersections, then emit them as an event so the ui can show it.
    const intersectingSegmentsUnchanged = oldPreviewSegmentIntersections.length === this.previewSegmentIntersections.length && oldPreviewSegmentIntersections.every((oldValue, index) => {
      const newValue = this.previewSegmentIntersections[index];
      return (
        oldValue.intersectionPoint.x === newValue.intersectionPoint.x &&
        oldValue.intersectionPoint.y === newValue.intersectionPoint.y &&
        oldValue.otherPolygonId == newValue.otherPolygonId &&
        oldValue.lineSegment.start.x === newValue.lineSegment.start.x &&
        oldValue.lineSegment.start.y === newValue.lineSegment.start.y &&
        oldValue.lineSegment.end.x === newValue.lineSegment.end.x &&
        oldValue.lineSegment.end.y === newValue.lineSegment.end.y &&
        oldValue.otherPolygonSegmentIndex === newValue.otherPolygonSegmentIndex
      );
    });
    if (!intersectingSegmentsUnchanged) {
      // Reset the key combo state if the key combo options changed!
      // Don't do this for every intersection update, only do it when the actual key combo entries
      // update (most likely because the actual points that are being shown themselves changed)
      if (
        this.previewSegmentIntersections.length === oldPreviewSegmentIntersections.length &&
        this.previewSegmentIntersections.every((a, i) => a.keyCombo === oldPreviewSegmentIntersections[i]?.keyCombo)
      ) {
        this.previewSegmentInteractionsKeyCombos
          .clear()
          .setKeyCombos(this.previewSegmentIntersections.map((inters) => inters.keyCombo));
        // Set the initial enabled state of each intersection based on whether the last preview
        // segment had it enabled
        if (this.lastPreviewSegmentEnabledIntersections) {
          for (const i of this.previewSegmentIntersections) {
            this.previewSegmentInteractionsEnabled.add(i.keyCombo);
          }
        } else {
          this.previewSegmentInteractionsEnabled.clear();
        }
        this.emit('previewSegmentIntersectionsEnabled', new Set(this.previewSegmentInteractionsEnabled.values()));
      }

      this.emit('previewSegmentIntersections', this.previewSegmentIntersections);
    }
  }

  /** Returns the current cursor string for this tool. */
  getCursor(): string {
    return 'pointer';
  }

  /** Sets the first handle hover state, capturing whether alt was held at hover start. */
  setHoveringFirstHandle(hovering: boolean): void {
    if (this.isHoveringFirstHandle !== hovering) {
      this.isHoveringFirstHandle = hovering;
      this.emit('hoveringFirstHandleChange', hovering);
      if (hovering) {
        this.altHeldOnFirstHandleHover = this.toolManager.getAltHeld();
      }
    }
  }

  /** Resets transient preview/interaction state for the polygon tool. */
  resetPreview(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
  }

  /** Full reset of all hover capture state. For testing use only. */
  resetForTesting(): void {
    this.previewSheetPos = null;
    this.isHoveringFirstHandle = false;
    this.altHeldOnFirstHandleHover = false;
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

    // Look for intersection key combos
    if (event.key.length === 1 && event.key.charCodeAt(0) >= 97 /* a */ && event.key.charCodeAt(0) <= 122 /* z */) {
      const matchingKeyCombo = this.previewSegmentInteractionsKeyCombos.push(event.key);
      if (matchingKeyCombo !== null) {
        // Toggle the entry in the set
        if (this.previewSegmentInteractionsEnabled.has(matchingKeyCombo)) {
          this.previewSegmentInteractionsEnabled.delete(matchingKeyCombo);
          // Reset this flat eagerly - if users disable an intersection then they probably don't
          // want it, sp don't re-enable it for them again on the next preview segment.
          this.lastPreviewSegmentEnabledIntersections = false;
        } else {
          this.previewSegmentInteractionsEnabled.add(matchingKeyCombo);
        }

        this.emit('previewSegmentIntersectionsEnabled', new Set(this.previewSegmentInteractionsEnabled.values()));
      }
    }
  }

  /** Switches the arc drawing mode between quadratic and cubic. */
  private setArcDrawMode(mode: 'quadratic' | 'cubic'): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      this.arcDrawMode = mode;
      this.emit('arcDrawModeChange', mode);
    }
  }

  /** Completes the polygon at the first handle (arc-close or normal close). */
  completePolygonAtFirstHandle(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (!wp) {
      return;
    }

    if (wp.points.length >= 2) {
      if (this.altHeldOnFirstHandleHover) {
        const firstPoint = wp.points[0].point;
        this.getGeometryStore().setWorkingPolygon({
          ...wp,
          pendingArcEndPoint: firstPoint,
        });
      } else {
        wp.points.push(wp.points[0]);
        this.getGeometryStore().setWorkingPolygon({ ...wp });

        this.completePolygon(true);
      }
    }

    this.setHoveringFirstHandle(false);
  }

  /** Adds a point or arc segment to the working polygon. */
  private addPoint(worldPos: WorldPosition): void {
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
      if (this.arcDrawMode === 'quadratic') {
        wp.points.push({ type: 'arc-quadratic', point: arcEnd, controlPoint: snapped });
      } else {
        const controlPointB = quadraticBezierControlFromMidpoint(prevPoint!, arcEnd, midPoint(prevPoint!, arcEnd));
        wp.points.push({ type: 'arc-cubic', point: arcEnd, controlPointA: snapped, controlPointB });
      }
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });
      if (arcEnd.x === wp.points[0].point.x && arcEnd.y === wp.points[0].point.y) {
        this.completePolygon(true);
      }
      return;
    } else if (this.toolManager.getAltHeld()) {
      wp.pendingArcEndPoint = snapped;
    } else {
      // Handle any intersections with other polygons that a user has chosen to apply
      this.lastPreviewSegmentEnabledIntersections = this.previewSegmentInteractionsEnabled.size > 0;
      for (const inters of this.previewSegmentIntersections) {
        if (this.previewSegmentInteractionsEnabled.has(inters.keyCombo)) {
          // Add the point to this working polygon
          wp.points.push({ type: 'point', point: inters.intersectionPoint });

          // Add the point to the other polygon
          this.getGeometryStore().updatePolygon(inters.otherPolygonId, (old) => {
            const points = old.points.slice();
            points.splice(inters.otherPolygonSegmentIndex, 0, { type: 'point', point: inters.intersectionPoint });
            return { ...old, points };
          });
        }
      }

      // Add the final point that represents where the user actually clicked
      wp.points.push({ type: 'point', point: snapped });
    }

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
      return;
    }

    this.getGeometryStore().addPolygon({
      points: wp.points,
      closed,
    });
    this.getGeometryStore().clearWorkingPolygon();
  }

  /** Aborts the current polygon drawing session. */
  private abortPolygon(): void {
    const wp = this.getGeometryStore().workingPolygon;
    if (wp && wp.pendingArcEndPoint !== null) {
      wp.pendingArcEndPoint = null;
      this.getGeometryStore().setWorkingPolygon({ ...wp });
    } else {
      this.getGeometryStore().clearWorkingPolygon();
    }

    this.previewSegmentInteractionsKeyCombos.clear();
    this.previewSegmentIntersections = [];
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
