import {
  Constraint,
  ConstraintEndpoint,
  ConstraintTemplate,
  Datum,
  DatumComponent,
  EllipseComponent,
  PolygonComponent,
  RectangleComponent,
} from '@/lib/geometry';
import { ID_PREFIXES } from '@/lib/geometry/GeometryStore';
import { type GeometryStore } from '@/lib/geometry/GeometryStore';
import { Vector2 } from '@/lib/math';
import {
  KeyPointShouldCreateDatum,
  applyKeyPointSnapping,
  applySnapping,
  applySnappingLineSeries,
} from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';
import { type ConstraintToolEvents } from './ConstraintTool';
import { ToolType, WorkingConstraint } from './types';

/**
 * Creates a {@link Datum} at the given position, locks the referenced constraint's
 * endpoint to it, and consolidates all other constraint free endpoints at
 * the same position to locked-datum. Returns the new locked-datum endpoint.
 */
function createDatumAndAttachExistingConstraints(
  geometryStore: GeometryStore,
  snap: KeyPointShouldCreateDatum,
): ConstraintEndpoint {
  // Create new datum
  const datum = geometryStore.add(ID_PREFIXES.datum, Datum.create(snap.position));
  geometryStore.updateConstraint(snap.constraintId, (c) => ({
    ...(c as any),
    [snap.key]: { type: 'locked-datum', id: datum.id },
  }));

  const datumEndpoint = ConstraintEndpoint.lockedToDatum(datum.id);

  // Rewrite any other constraint endpoints which happen to be at that datum position to _also_ be
  // locked to the datum.
  for (const c of geometryStore.constraints) {
    if (c.id === snap.constraintId) {
      continue;
    }
    const keys = Constraint.getPositionKeys(c);
    for (const k of keys) {
      const ep = (c as any)[k] as ConstraintEndpoint;
      if (ep.type === 'point' && ep.point.x === snap.position.x && ep.point.y === snap.position.y) {
        geometryStore.updateConstraint(c.id, (existing: any) => ({
          ...existing,
          [k]: datumEndpoint,
        }));
      }
    }
  }

  return datumEndpoint;
}

/** An abstract tool which lets a user create some sort of constraint which consists of a single
 * line segment, made up of two points.
 *
 * Example implementer: LinearConstraintTool */
export abstract class LineSegmentConstraintTool<
  WC extends WorkingConstraint & { pointA: ConstraintEndpoint; pointB: ConstraintEndpoint },
  Type extends string = ToolType,
> extends BaseTool<ConstraintToolEvents, Type> {
  private previewSheetPos: SheetPosition | null = null;

  // Should a datum be created at either line segment endpoint on constraint completion?
  private pendingPointAShouldCreateDatum: KeyPointShouldCreateDatum | null = null;
  private pendingPointBShouldCreateDatum: KeyPointShouldCreateDatum | null = null;

  protected abstract deriveWorkingConstraintFromEndPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): WC;

  /** Converts the working constraint {@link WC} into the final {@link Constraint} type once the
   * tool is complete.*/
  protected abstract convertWorkingConstraintIntoConstraint(
    workingConstraint: WC,
    lengthBetweenPoints: Length,
    xAxisLengthBetweenPoints: Length,
    yAxisLengthBetweenPoints: Length,
  ): ConstraintTemplate;

  /** Type assert that the given working constraint is {@link WC} */
  protected abstract isWorkingConstraint(wc: WorkingConstraint): wc is WC;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    if (geometryStore.workingConstraints.length === 0) {
      const { endpoint, shouldCreateDatum } = applyKeyPointSnapping(
        sheetPos,
        this.toolManager.getCtrlHeld(),
        {
          primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
          secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
          superHeld: this.toolManager.getSuperHeld(),
          viewportScale: viewport.scale,
          rectangles: geometryStore.listWithComponent(RectangleComponent),
          ellipses: geometryStore.listWithComponent(EllipseComponent),
          polygons: geometryStore.listWithComponent(PolygonComponent),
          constraints: geometryStore.constraints,
          datums: geometryStore.listWithComponent(DatumComponent),
        },
      );
      this.pendingPointAShouldCreateDatum = shouldCreateDatum;
      geometryStore.setWorkingConstraints([
        this.deriveWorkingConstraintFromEndPoints(endpoint, endpoint),
      ]);
    } else {
      this.completeConstraint();
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const { endpoint: keyPointEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
        ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
        polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
        constraints: this.getGeometryStore().constraints,
        datums: this.getGeometryStore().listWithComponent(DatumComponent),
      },
    );

    this.pendingPointBShouldCreateDatum = shouldCreateDatum;

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    if (isSnapped) {
      this.emit('keyPointSnapChange', {
        endpoint: keyPointEndpoint,
        screenPosition: screenPos,
        shouldCreateDatum: shouldCreateDatum !== null,
      });
    } else {
      this.emit('keyPointSnapChange', null);
    }

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    const wc = this.getGeometryStore().workingConstraints;
    if (wc.length > 0 && this.isWorkingConstraint(wc[0])) {
      this.getGeometryStore().setWorkingConstraints((old) =>
        old.length > 0 && this.isWorkingConstraint(old[0])
          ? [{ ...old[0], pointB: keyPointEndpoint }]
          : old,
      );
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    const anchorPos =
      wc && this.isWorkingConstraint(wc)
        ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA)
        : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortConstraint();
      return true;
    } else if (event.key === 'Enter' && this.previewSheetPos) {
      this.completeConstraint();
      return true;
    }
    return false;
  }

  private completeConstraint(): void {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }

    const first = this.getGeometryStore().workingConstraints?.[0];
    if (!first || !this.isWorkingConstraint(first)) {
      return;
    }
    let wc = first;

    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedA || !resolvedB) {
      return;
    }

    if (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) {
      // Don't allow creating 0 length constraints
      return;
    }

    this.getHistoryManager().applyTransaction('add-line-segment-constraint', () => {
      // Process any deferred datum creations from the first click (pointA) and
      // the mouse-move (pointB). Creating datums here ensures aborted constraints
      // don't leave orphaned datums.
      const geometryStore = this.getGeometryStore();
      if (this.pendingPointAShouldCreateDatum) {
        const ep = createDatumAndAttachExistingConstraints(
          geometryStore,
          this.pendingPointAShouldCreateDatum,
        );
        wc = { ...wc, pointA: ep } as WC;
        this.pendingPointAShouldCreateDatum = null;
      }
      if (this.pendingPointBShouldCreateDatum) {
        const ep = createDatumAndAttachExistingConstraints(
          geometryStore,
          this.pendingPointBShouldCreateDatum,
        );
        wc = { ...wc, pointB: ep } as WC;
        this.pendingPointBShouldCreateDatum = null;
      }

      const diagonal = Vector2.distance(resolvedA, resolvedB);
      const xAxis = Math.abs(resolvedB.x - resolvedA.x);
      const yAxis = Math.abs(resolvedB.y - resolvedA.y);

      this.getGeometryStore().addConstraint(
        this.convertWorkingConstraintIntoConstraint(
          wc,
          Length.fromSheetUnits(sheet.defaultUnit, diagonal),
          Length.fromSheetUnits(sheet.defaultUnit, xAxis),
          Length.fromSheetUnits(sheet.defaultUnit, yAxis),
        ),
      );
      this.getGeometryStore().clearWorkingConstraints();
    });

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.getGeometryStore().clearWorkingConstraints();
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}

/** An abstract tool which lets a user create a constraint consisting of a line segment
 *  (pointA and pointB) and a target point (pointTarget) that must lie on that line.
 *
 *  First click places the target point, second and third clicks define the reference line.
 *
 *  Example implementer: ColinearConstraintTool */
export abstract class SegmentAndPointConstraintTool<
  WC extends WorkingConstraint & {
    pointTarget: ConstraintEndpoint;
    pointA: ConstraintEndpoint | null;
    pointB: ConstraintEndpoint | null;
  },
  Type extends string = ToolType,
> extends BaseTool<ConstraintToolEvents, Type> {
  private previewSheetPos: SheetPosition | null = null;
  private state: 'idle' | 'placing-pointa' | 'placing-pointb' = 'idle';

  // Should a datum be created at any endpoint on constraint completion?
  private pendingTargetSnap: KeyPointShouldCreateDatum | null = null;
  private pendingPointASnap: KeyPointShouldCreateDatum | null = null;
  private pendingPointBSnap: KeyPointShouldCreateDatum | null = null;

  /** Creates the initial {@link WC} working constraint state for the tool.
   *  pointA and pointB may be null until the second click. */
  protected abstract deriveWorkingConstraintFromThreePoints(
    pointTarget: ConstraintEndpoint,
    pointA: ConstraintEndpoint | null,
    pointB: ConstraintEndpoint | null,
  ): WC;

  /** Converts the working constraint {@link WC} into the final {@link Constraint} type once the
   * tool is complete. pointA/pointB are guaranteed non-null. */
  protected abstract convertWorkingConstraintIntoConstraint(
    workingConstraint: WC & { pointA: ConstraintEndpoint; pointB: ConstraintEndpoint },
  ): ConstraintTemplate;

  /** Type assert that the given working constraint is {@link WC} */
  protected abstract isWorkingConstraint(wc: WorkingConstraint): wc is WC;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const { endpoint: rawEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
        constraints: geometryStore.constraints,
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint so aborted constraints
    // don't leave orphaned datums.
    switch (this.state) {
      case 'idle':
        this.pendingTargetSnap = shouldCreateDatum;
        break;
      case 'placing-pointa':
        this.pendingPointASnap = shouldCreateDatum;
        break;
      case 'placing-pointb':
        this.pendingPointBSnap = shouldCreateDatum;
        break;
    }

    const wc = geometryStore.workingConstraints[0];

    switch (this.state) {
      case 'idle':
        // First click: set pointTarget, leave pointA/pointB null
        geometryStore.setWorkingConstraints([
          this.deriveWorkingConstraintFromThreePoints(rawEndpoint, null, null),
        ]);
        this.state = 'placing-pointa';
        break;

      case 'placing-pointa':
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        // Second click: set both pointA and pointB to the same endpoint
        geometryStore.setWorkingConstraints([
          { ...wc, pointA: rawEndpoint, pointB: rawEndpoint } as WC,
        ]);
        this.state = 'placing-pointb';
        break;

      case 'placing-pointb':
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        // Third click: fix pointB and complete
        geometryStore.setWorkingConstraints([{ ...wc, pointB: rawEndpoint } as WC]);
        this.completeConstraint();
        break;
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const { endpoint: keyPointEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
        ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
        polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
        constraints: this.getGeometryStore().constraints,
        datums: this.getGeometryStore().listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint
    switch (this.state) {
      case 'placing-pointa':
        this.pendingPointASnap = shouldCreateDatum;
        break;
      case 'placing-pointb':
        this.pendingPointBSnap = shouldCreateDatum;
        break;
    }

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    if (isSnapped) {
      this.emit('keyPointSnapChange', {
        endpoint: keyPointEndpoint,
        screenPosition: screenPos,
        shouldCreateDatum: shouldCreateDatum !== null,
      });
    } else {
      this.emit('keyPointSnapChange', null);
    }

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    switch (this.state) {
      case 'idle':
        return;

      case 'placing-pointa':
        // Only pointTarget is set, update pointA preview (line will appear when pointB is set too)
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointA: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;

      case 'placing-pointb':
        // pointA is set, update pointB preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointB: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || !this.isWorkingConstraint(wc)) {
      return applySnapping(sheetPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    let anchorPos: SheetPosition | null = null;
    switch (this.state) {
      case 'idle':
        break;
      case 'placing-pointa':
        anchorPos = this.getGeometryStore().resolveConstraintEndpoint(wc.pointTarget);
        break;
      case 'placing-pointb':
        if (wc.pointA) {
          anchorPos = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
        }
        break;
    }

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortConstraint();
      return true;
    } else if (event.key === 'Enter' && this.previewSheetPos) {
      this.completeConstraint();
      return true;
    }
    return false;
  }

  private completeConstraint(): void {
    const first = this.getGeometryStore().workingConstraints?.[0];
    if (!first || !this.isWorkingConstraint(first)) {
      return;
    }
    let wc = first;

    if (!wc.pointA || !wc.pointB) {
      return;
    }

    const resolvedTarget = this.getGeometryStore().resolveConstraintEndpoint(wc.pointTarget);
    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedTarget || !resolvedA || !resolvedB) {
      return;
    }

    // Verify the reference segment has non-zero length
    if (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) {
      return;
    }

    this.getHistoryManager().applyTransaction('add-segment-and-point-constraint', () => {
      // Process deferred datum creations before finalizing
      const gs = this.getGeometryStore();
      if (this.pendingTargetSnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingTargetSnap);
        wc = { ...wc, pointTarget: ep } as WC;
        this.pendingTargetSnap = null;
      }
      if (this.pendingPointASnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingPointASnap);
        wc = { ...wc, pointA: ep } as WC;
        this.pendingPointASnap = null;
      }
      if (this.pendingPointBSnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingPointBSnap);
        wc = { ...wc, pointB: ep } as WC;
        this.pendingPointBSnap = null;
      }

      // Add the actual constraint (pointA/pointB guaranteed non-null by the check above)
      this.getGeometryStore().addConstraint(
        this.convertWorkingConstraintIntoConstraint(
          wc as WC & { pointA: ConstraintEndpoint; pointB: ConstraintEndpoint },
        ),
      );
      this.getGeometryStore().clearWorkingConstraints();
    });

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.state = 'idle';
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}

/** An abstract tool which lets a user create some sort of constraint which consists of two line
 * segments which share a common vertex and form some sort of angle.
 *
 * Example implementer: PerpendicularConstraintTool */
export abstract class TwoConnectedSegmentConstraintCreationTool<
  WC extends WorkingConstraint & {
    pointA: ConstraintEndpoint;
    pointCenter: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
  },
  Type extends string = ToolType,
> extends BaseTool<ConstraintToolEvents, Type> {
  private previewSheetPos: SheetPosition | null = null;
  private state: 'idle' | 'placing-pointa' | 'placing-pointb' = 'idle';

  // Should a datum be created at any endpoint on constraint completion?
  private pendingCenterSnap: KeyPointShouldCreateDatum | null = null;
  private pendingPointASnap: KeyPointShouldCreateDatum | null = null;
  private pendingPointBSnap: KeyPointShouldCreateDatum | null = null;

  /** Creates the initial {@link WC} working constraint state for the tool. */
  protected abstract deriveWorkingConstraintFromThreePoints(
    pointA: ConstraintEndpoint,
    pointCenter: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
  ): WC;

  /** Converts the working constraint {@link WC} into the final {@link Constraint} type once the
   * tool is complete.*/
  protected abstract convertWorkingConstraintIntoConstraint(
    workingConstraint: WC,
  ): ConstraintTemplate;

  /** Type assert that the given working constraint is {@link WC} */
  protected abstract isWorkingConstraint(wc: WorkingConstraint): wc is WC;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const { endpoint: rawEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
        constraints: geometryStore.constraints,
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint so aborted constraints
    // don't leave orphaned datums.
    switch (this.state) {
      case 'idle':
        this.pendingCenterSnap = shouldCreateDatum;
        break;
      case 'placing-pointa':
        this.pendingPointASnap = shouldCreateDatum;
        break;
      case 'placing-pointb':
        this.pendingPointBSnap = shouldCreateDatum;
        break;
    }

    const wc = geometryStore.workingConstraints[0];

    switch (this.state) {
      case 'idle':
        // First click: set pointCenter
        geometryStore.setWorkingConstraints([
          this.deriveWorkingConstraintFromThreePoints(rawEndpoint, rawEndpoint, rawEndpoint),
        ]);
        this.state = 'placing-pointa';
        break;

      case 'placing-pointa':
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        // Second click: set pointA
        geometryStore.setWorkingConstraints([{ ...wc, pointA: rawEndpoint }]);
        this.state = 'placing-pointb';
        break;

      case 'placing-pointb':
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        // Third click: set pointB and complete
        geometryStore.setWorkingConstraints([{ ...wc, pointB: rawEndpoint }]);
        this.completeConstraint();
        break;
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const { endpoint: keyPointEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
        ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
        polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
        constraints: this.getGeometryStore().constraints,
        datums: this.getGeometryStore().listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint
    switch (this.state) {
      case 'placing-pointa':
        this.pendingPointASnap = shouldCreateDatum;
        break;
      case 'placing-pointb':
        this.pendingPointBSnap = shouldCreateDatum;
        break;
    }

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    if (isSnapped) {
      this.emit('keyPointSnapChange', {
        endpoint: keyPointEndpoint,
        screenPosition: screenPos,
        shouldCreateDatum: shouldCreateDatum !== null,
      });
    } else {
      this.emit('keyPointSnapChange', null);
    }

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    switch (this.state) {
      case 'idle':
        return;

      case 'placing-pointa':
        // Only pointCenter is set, update pointA preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointA: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;

      case 'placing-pointb':
        // pointA is set, update pointB preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointB: keyPointEndpoint }];
          } else {
            return old;
          }
        });
        return;
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    const anchorPos =
      wc && this.isWorkingConstraint(wc)
        ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA)
        : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortConstraint();
      return true;
    } else if (event.key === 'Enter' && this.previewSheetPos) {
      this.completeConstraint();
      return true;
    }
    return false;
  }

  private completeConstraint(): void {
    const first = this.getGeometryStore().workingConstraints?.[0];
    if (!first || !this.isWorkingConstraint(first)) {
      return;
    }
    let wc = first;

    const resolvedCenter = this.getGeometryStore().resolveConstraintEndpoint(wc.pointCenter);
    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedC = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedCenter || !resolvedA || !resolvedC) {
      return;
    }

    // Verify all three points are different
    if (
      (resolvedCenter.x === resolvedA.x && resolvedCenter.y === resolvedA.y) ||
      (resolvedCenter.x === resolvedC.x && resolvedCenter.y === resolvedC.y) ||
      (resolvedA.x === resolvedC.x && resolvedA.y === resolvedC.y)
    ) {
      return;
    }

    this.getHistoryManager().applyTransaction('add-two-connected-segment-constraint', () => {
      // Process deferred datum creations before finalizing
      const gs = this.getGeometryStore();
      if (this.pendingCenterSnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingCenterSnap);
        wc = { ...wc, pointCenter: ep } as WC;
        this.pendingCenterSnap = null;
      }
      if (this.pendingPointASnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingPointASnap);
        wc = { ...wc, pointA: ep } as WC;
        this.pendingPointASnap = null;
      }
      if (this.pendingPointBSnap) {
        const ep = createDatumAndAttachExistingConstraints(gs, this.pendingPointBSnap);
        wc = { ...wc, pointB: ep } as WC;
        this.pendingPointBSnap = null;
      }

      // Add the actual constraint
      this.getGeometryStore().addConstraint(this.convertWorkingConstraintIntoConstraint(wc));
      this.getGeometryStore().clearWorkingConstraints();
    });

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.state = 'idle';
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}

/** An abstract tool which lets a user create a constraint consisting of two independent line
 *  segments, defined by four consecutively clicked points.
 *
 *  First two clicks define segment AB, last two clicks define segment CD.
 *
 *  Example implementer: ParallelConstraintTool */
export abstract class TwoSegmentConstraintCreationTool<
  WC extends WorkingConstraint & {
    pointA: ConstraintEndpoint;
    pointB: ConstraintEndpoint;
    pointC: ConstraintEndpoint;
    pointD: ConstraintEndpoint;
  },
  Type extends string = ToolType,
> extends BaseTool<ConstraintToolEvents, Type> {
  private previewSheetPos: SheetPosition | null = null;
  private state: 'idle' | 'placing-a' | 'placing-b' | 'placing-c' = 'idle';

  // Should a datum be created at any endpoint on constraint completion?
  private pendingSnapA: KeyPointShouldCreateDatum | null = null;
  private pendingSnapB: KeyPointShouldCreateDatum | null = null;
  private pendingSnapC: KeyPointShouldCreateDatum | null = null;
  private pendingSnapD: KeyPointShouldCreateDatum | null = null;

  /** Creates the initial {@link WC} working constraint state for the tool. */
  protected abstract deriveWorkingConstraintFromFourPoints(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    pointC: ConstraintEndpoint,
    pointD: ConstraintEndpoint,
  ): WC;

  /** Converts the working constraint {@link WC} into the final {@link Constraint} type once the
   *  tool is complete. */
  protected abstract convertWorkingConstraintIntoConstraint(
    workingConstraint: WC,
  ): ConstraintTemplate;

  /** Type assert that the given working constraint is {@link WC} */
  protected abstract isWorkingConstraint(wc: WorkingConstraint): wc is WC;

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const { endpoint: rawEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
        constraints: geometryStore.constraints,
        datums: geometryStore.listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint so aborted constraints
    // don't leave orphaned datums.
    switch (this.state) {
      case 'idle':
        this.pendingSnapA = shouldCreateDatum;
        break;
      case 'placing-a':
        this.pendingSnapB = shouldCreateDatum;
        break;
      case 'placing-b':
        this.pendingSnapC = shouldCreateDatum;
        break;
      case 'placing-c':
        this.pendingSnapD = shouldCreateDatum;
        break;
    }

    switch (this.state) {
      case 'idle': {
        // Click 1: initialize all four points at the clicked position
        const wc = this.deriveWorkingConstraintFromFourPoints(
          rawEndpoint,
          rawEndpoint,
          rawEndpoint,
          rawEndpoint,
        );
        geometryStore.setWorkingConstraints([wc]);
        this.state = 'placing-a';
        break;
      }
      case 'placing-a': {
        // Click 2: fix pointB, segment AB is now locked
        const wc = geometryStore.workingConstraints[0];
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        geometryStore.setWorkingConstraints([
          { ...wc, pointB: rawEndpoint, pointC: rawEndpoint, pointD: rawEndpoint },
        ]);
        this.state = 'placing-b';
        break;
      }
      case 'placing-b': {
        // Click 3: fix pointC
        const wc = geometryStore.workingConstraints[0];
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        geometryStore.setWorkingConstraints([{ ...wc, pointC: rawEndpoint, pointD: rawEndpoint }]);
        this.state = 'placing-c';
        break;
      }
      case 'placing-c': {
        // Click 4: fix pointD and complete
        const wc = geometryStore.workingConstraints[0];
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        geometryStore.setWorkingConstraints([{ ...wc, pointD: rawEndpoint }]);
        this.completeConstraint();
        break;
      }
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const { endpoint: keyPointEndpoint, shouldCreateDatum } = applyKeyPointSnapping(
      sheetPos,
      this.toolManager.getCtrlHeld(),
      {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
        ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
        polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
        constraints: this.getGeometryStore().constraints,
        datums: this.getGeometryStore().listWithComponent(DatumComponent),
      },
    );

    // Defer datum creation to completeConstraint
    switch (this.state) {
      case 'placing-a':
        this.pendingSnapB = shouldCreateDatum;
        break;
      case 'placing-b':
        this.pendingSnapC = shouldCreateDatum;
        break;
      case 'placing-c':
        this.pendingSnapD = shouldCreateDatum;
        break;
    }

    let isSnapped = false;
    if (keyPointEndpoint.type !== 'point') {
      const keyPointPos = this.getGeometryStore().resolveConstraintEndpoint(keyPointEndpoint);
      if (keyPointPos) {
        this.previewSheetPos = keyPointPos;
        isSnapped = true;
      } else {
        this.previewSheetPos = gridSnapped;
      }
    } else {
      this.previewSheetPos = gridSnapped;
    }

    if (isSnapped) {
      this.emit('keyPointSnapChange', {
        endpoint: keyPointEndpoint,
        screenPosition: screenPos,
        shouldCreateDatum: shouldCreateDatum !== null,
      });
    } else {
      this.emit('keyPointSnapChange', null);
    }

    this.emit('previewSheetPositionChange', {
      position: this.previewSheetPos,
      isSnappedToKeyPoint: isSnapped,
    });

    switch (this.state) {
      case 'idle':
        return;

      case 'placing-a':
        // Segment AB not yet locked: update pointB preview
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointB: keyPointEndpoint }];
          }
          return old;
        });
        return;

      case 'placing-b':
        // Segment AB locked: update pointC + pointD preview together
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointC: keyPointEndpoint, pointD: keyPointEndpoint }];
          }
          return old;
        });
        return;

      case 'placing-c':
        // pointC fixed: update pointD preview only
        this.getGeometryStore().setWorkingConstraints((old) => {
          if (old.length > 0 && this.isWorkingConstraint(old[0])) {
            return [{ ...old[0], pointD: keyPointEndpoint }];
          }
          return old;
        });
        return;
    }
  }

  protected defaultCursor = 'pointer';

  private computePreviewSnappedPos(
    screenPos: ScreenPosition,
    viewport: ViewportState,
  ): SheetPosition {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();

    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || !this.isWorkingConstraint(wc)) {
      return applySnapping(sheetPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    // Anchor on the most recently fixed point
    let anchorPos: SheetPosition | null = null;
    switch (this.state) {
      case 'idle':
        break;
      case 'placing-a':
        anchorPos = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
        break;
      case 'placing-b':
        anchorPos = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
        break;
      case 'placing-c':
        anchorPos = this.getGeometryStore().resolveConstraintEndpoint(wc.pointC);
        break;
    }

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        ctrlHeld: this.toolManager.getCtrlHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape') {
      this.abortConstraint();
      return true;
    }
    return false;
  }

  private completeConstraint(): void {
    const first = this.getGeometryStore().workingConstraints?.[0];
    if (!first || !this.isWorkingConstraint(first)) {
      return;
    }
    let wc = first;

    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    const resolvedC = this.getGeometryStore().resolveConstraintEndpoint(wc.pointC);
    const resolvedD = this.getGeometryStore().resolveConstraintEndpoint(wc.pointD);
    if (!resolvedA || !resolvedB || !resolvedC || !resolvedD) {
      return;
    }

    // Verify all four points form valid segments (non-zero length)
    if (
      (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) ||
      (resolvedC.x === resolvedD.x && resolvedC.y === resolvedD.y)
    ) {
      return;
    }

    this.getHistoryManager().applyTransaction('add-two-segment-constraint', () => {
      // Process deferred datum creations before finalizing
      const geometryStore = this.getGeometryStore();
      if (this.pendingSnapA) {
        const ep = createDatumAndAttachExistingConstraints(geometryStore, this.pendingSnapA);
        wc = { ...wc, pointA: ep } as WC;
        this.pendingSnapA = null;
      }
      if (this.pendingSnapB) {
        const ep = createDatumAndAttachExistingConstraints(geometryStore, this.pendingSnapB);
        wc = { ...wc, pointB: ep } as WC;
        this.pendingSnapB = null;
      }
      if (this.pendingSnapC) {
        const ep = createDatumAndAttachExistingConstraints(geometryStore, this.pendingSnapC);
        wc = { ...wc, pointC: ep } as WC;
        this.pendingSnapC = null;
      }
      if (this.pendingSnapD) {
        const ep = createDatumAndAttachExistingConstraints(geometryStore, this.pendingSnapD);
        wc = { ...wc, pointD: ep } as WC;
        this.pendingSnapD = null;
      }

      // Actually insert constraint
      this.getGeometryStore().addConstraint(this.convertWorkingConstraintIntoConstraint(wc));
      this.getGeometryStore().clearWorkingConstraints();
    });

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.state = 'idle';
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.emit('keyPointSnapChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}
