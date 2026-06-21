import {
  ConstraintEndpoint,
  ConstraintTemplate,
  EllipseComponent,
  LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
  LinearConstraint,
  PerpendicularConstraint,
  PolygonComponent,
  RectangleComponent,
} from '@/lib/geometry';
import { distance } from '@/lib/math';
import { applyKeyPointSnapping, applySnapping, applySnappingLineSeries } from '@/lib/snapping';
import { Length } from '@/lib/units/length';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';
import { type ConstraintToolEvents } from './ConstraintTool';
import { ToolType, WorkingConstraint } from './types';

/** An abstract tool which lets a user create some sort of constraint which consists of a single
 * line segment, made up of two points.
 *
 * Example implementer: LinearConstraintTool */
export abstract class LineSegmentConstraintTool<
  WC extends WorkingConstraint & { pointA: ConstraintEndpoint; pointB: ConstraintEndpoint },
  Type extends string = ToolType,
> extends BaseTool<ConstraintToolEvents, Type> {
  private previewSheetPos: SheetPosition | null = null;

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
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    if (geometryStore.workingConstraints.length === 0) {
      const gridSnapped = this.applySnapping(sheetPos);
      const endpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        superHeld: this.toolManager.getSuperHeld(),
        viewportScale: viewport.scale,
        rectangles: geometryStore.listWithComponent(RectangleComponent),
        ellipses: geometryStore.listWithComponent(EllipseComponent),
        polygons: geometryStore.listWithComponent(PolygonComponent),
      });
      geometryStore.setWorkingConstraints([
        this.deriveWorkingConstraintFromEndPoints(endpoint, endpoint),
      ]);
    } else {
      this.completeConstraint();
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
      ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
      polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
    });

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
    const anchorPos = wc ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA) : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        shiftHeld: this.toolManager.getShiftHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
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

    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || !this.isWorkingConstraint(wc)) {
      return;
    }

    const resolvedA = this.getGeometryStore().resolveConstraintEndpoint(wc.pointA);
    const resolvedB = this.getGeometryStore().resolveConstraintEndpoint(wc.pointB);
    if (!resolvedA || !resolvedB) {
      return;
    }

    if (resolvedA.x === resolvedB.x && resolvedA.y === resolvedB.y) {
      // Don't allow creating 0 length constraints
      return;
    }

    const diagonal = distance(resolvedA, resolvedB);
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

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.getGeometryStore().clearWorkingConstraints();
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
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
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const worldPos = screenPos.toWorld(viewport);
    const sheetPos = worldPos.toSheet();
    const geometryStore = this.getGeometryStore();

    const gridSnapped = this.applySnapping(sheetPos);
    const endpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: geometryStore.listWithComponent(RectangleComponent),
      ellipses: geometryStore.listWithComponent(EllipseComponent),
      polygons: geometryStore.listWithComponent(PolygonComponent),
    });

    const wc = geometryStore.workingConstraints[0];

    switch (this.state) {
      case 'idle':
        // First click: set pointCenter
        geometryStore.setWorkingConstraints([
          this.deriveWorkingConstraintFromThreePoints(endpoint, endpoint, endpoint),
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
        geometryStore.setWorkingConstraints([{ ...wc, pointA: endpoint }]);
        this.state = 'placing-pointb';
        break;

      case 'placing-pointb':
        if (!this.isWorkingConstraint(wc)) {
          throw new Error(
            `Working constraints first item is of type ${wc.type}, which cannot be processed by ${this.constructor.name}`,
          );
        }
        // Third click: set pointB and complete
        geometryStore.setWorkingConstraints([{ ...wc, pointB: endpoint }]);
        this.completeConstraint();
        break;
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
      ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
      polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
    });

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
    const anchorPos = wc ? this.getGeometryStore().resolveConstraintEndpoint(wc.pointA) : null;

    if (anchorPos) {
      return applySnappingLineSeries(sheetPos, anchorPos, {
        primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
        secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
        shiftHeld: this.toolManager.getShiftHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
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
    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || !this.isWorkingConstraint(wc)) {
      return;
    }

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

    this.getGeometryStore().addConstraint(this.convertWorkingConstraintIntoConstraint(wc));
    this.getGeometryStore().clearWorkingConstraints();

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.state = 'idle';
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
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

    const gridSnapped = this.applySnapping(sheetPos);
    const endpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: geometryStore.listWithComponent(RectangleComponent),
      ellipses: geometryStore.listWithComponent(EllipseComponent),
      polygons: geometryStore.listWithComponent(PolygonComponent),
    });

    switch (this.state) {
      case 'idle': {
        // Click 1: initialize all four points at the clicked position
        const wc = this.deriveWorkingConstraintFromFourPoints(
          endpoint,
          endpoint,
          endpoint,
          endpoint,
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
          { ...wc, pointB: endpoint, pointC: endpoint, pointD: endpoint },
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
        geometryStore.setWorkingConstraints([{ ...wc, pointC: endpoint, pointD: endpoint }]);
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
        geometryStore.setWorkingConstraints([{ ...wc, pointD: endpoint }]);
        this.completeConstraint();
        break;
      }
    }
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const gridSnapped = this.computePreviewSnappedPos(screenPos, viewport);

    const keyPointEndpoint = applyKeyPointSnapping(gridSnapped, this.toolManager.getShiftHeld(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
      rectangles: this.getGeometryStore().listWithComponent(RectangleComponent),
      ellipses: this.getGeometryStore().listWithComponent(EllipseComponent),
      polygons: this.getGeometryStore().listWithComponent(PolygonComponent),
    });

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
        shiftHeld: this.toolManager.getShiftHeld(),
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
        shiftHeld: this.toolManager.getShiftHeld(),
        superHeld: this.toolManager.getSuperHeld(),
      });
    }

    return applySnapping(sheetPos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
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
    const wc = this.getGeometryStore().workingConstraints?.[0];
    if (!wc || !this.isWorkingConstraint(wc)) {
      return;
    }

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

    this.getGeometryStore().addConstraint(this.convertWorkingConstraintIntoConstraint(wc));
    this.getGeometryStore().clearWorkingConstraints();

    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.state = 'idle';
  }

  private abortConstraint(): void {
    this.previewSheetPos = null;
    this.emit('previewSheetPositionChange', null);
    this.getGeometryStore().clearWorkingConstraints();
    this.state = 'idle';
  }

  private applySnapping(pos: SheetPosition): SheetPosition {
    return applySnapping(pos, {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      shiftHeld: this.toolManager.getShiftHeld(),
      superHeld: this.toolManager.getSuperHeld(),
    });
  }
}
