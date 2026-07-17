import { ActionsManager } from '@/lib/actions/ActionsManager';
import {
  ConstraintComponent,
  EllipseComponent,
  LinearConstraint,
  LinearConstraintData,
} from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { SHEET_UNITS_TO_PIXELS, Sheet } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { EllipseTool } from '@/lib/tools/EllipseTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { WorkingLinearConstraint } from '@/lib/tools/types';
import { CentimetersLength, CentimetersType } from '@/lib/units/length';
import { ScreenPosition, ViewportPosition, type ViewportState } from '@/lib/viewport/types';

function createViewportState(scale: number = 1): ViewportState {
  return {
    position: new ViewportPosition(0, 0),
    scale,
  };
}

describe('EllipseTool', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let toolManager: ToolManager;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;
  let ellipseTool: EllipseTool;
  let viewport: ViewportState;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(
      new SerializationManager(actionsManager, toolManager, sheet),
    );
    ellipseTool = toolManager.getTool('ellipse') as EllipseTool;
    viewport = createViewportState(1);
    toolManager.setSnappingOptions({ primaryGridSize: 0.001, secondaryGridSize: 0.001 });
    toolManager.setActiveTool('ellipse');
  });

  describe('basic ellipse creation + completion', () => {
    it('first click creates working ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.firstPoint).not.toBeNull();
      expect(we!.previewPoint).toBeNull();
      expect(we!.isCenterMode).toBe(false);
    });

    it('mouse move updates preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(30 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('second click completes ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);
      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(1);
      expect(geometryStore.workingEllipse).toBeNull();

      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      const centerX = 20 / SHEET_UNITS_TO_PIXELS;
      const centerY = 15 / SHEET_UNITS_TO_PIXELS;
      const radiusX = 10 / SHEET_UNITS_TO_PIXELS;
      const radiusY = 5 / SHEET_UNITS_TO_PIXELS;
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(centerX, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(centerY, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(radiusX, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(radiusY, 2);
    });

    it('clicking same location twice should not complete zero-size ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });
  });

  describe('corner mode bounds', () => {
    it('center computed from bounding box corners', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);

      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('clicking in reverse order produces same bounds', () => {
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('center mode', () => {
    it('alt on first click enters center mode', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.isCenterMode).toBe(true);
      expect(we!.firstPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.firstPoint!.y).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('center mode uses second point as direct radius', () => {
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 20), viewport);

      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(0.156, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(0.156, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(0.313, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(0.157, 2);
    });
  });

  describe('circle constraint (shift)', () => {
    it('shift held forces circular point during preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(10, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint!.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it.skip('circle constrained ellipse completes correctly', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(1);
      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it.skip('shift constrains correctly even when mouse moves to negative quadrant', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);

      toolManager.handleKeyDown({ key: 'Shift' } as KeyboardEvent);
      toolManager.handleMouseMove(new ScreenPosition(5, 20), viewport);
      toolManager.handleKeyUp({ key: 'Shift' } as KeyboardEvent);

      const we = geometryStore.workingEllipse;
      expect(we!.previewPoint!.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
    });
  });

  describe('alt toggles center mode', () => {
    it('alt key toggles isCenterMode while drawing', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(false);

      const events = subscribeToEvents(ellipseTool, ['isCenterModeChange']);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(true);
      expect(events.areThereBufferedEvents('isCenterModeChange')).toBe(true);
    });

    it('alt key up re-evaluates center mode from toolManager', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(true);

      toolManager.handleKeyUp({ key: 'Alt', altKey: false } as KeyboardEvent);
      expect(geometryStore.workingEllipse!.isCenterMode).toBe(false);
    });
  });

  describe('keyboard shortcuts', () => {
    it('escape aborts ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Escape' } as KeyboardEvent);

      expect(geometryStore.workingEllipse).toBeNull();
      expect(ellipseTool.previewSheetPos).toBeNull();
    });

    it('enter completes with current preview', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(1);
      expect(geometryStore.workingEllipse).toBeNull();

      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).center.x).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).center.y).toBeCloseTo(15 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS, 2);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(5 / SHEET_UNITS_TO_PIXELS, 2);
    });

    it('enter does nothing when no preview is set', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      toolManager.handleKeyDown({ key: 'Enter' } as KeyboardEvent);

      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(0);
      expect(geometryStore.workingEllipse).not.toBeNull();
    });
  });

  describe('degenerate ellipse abort', () => {
    it('radiusX <= 0 triggers abort', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(10, 20), viewport);
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);

      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });

    it('radiusY <= 0 triggers abort', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 10), viewport);
      toolManager.handleMouseDown(new ScreenPosition(30, 10), viewport);

      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(0);
      expect(geometryStore.workingEllipse).toBeNull();
    });
  });

  describe('tool focus / blur', () => {
    it('blur clears working ellipse', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      ellipseTool.handleToolBlur();

      expect(geometryStore.workingEllipse).toBeNull();
    });

    it('blur clears previewSheetPos', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);
      expect(ellipseTool.previewSheetPos).not.toBeNull();

      ellipseTool.handleToolBlur();

      expect(ellipseTool.previewSheetPos).toBeNull();
    });

    it('blur emits previewSheetPositionChange(null)', () => {
      toolManager.handleMouseDown(new ScreenPosition(10, 10), viewport);
      toolManager.handleMouseMove(new ScreenPosition(30, 20), viewport);

      const events = subscribeToEvents(ellipseTool, ['previewSheetPositionChange']);
      ellipseTool.handleToolBlur();

      expect(events.areThereBufferedEvents('previewSheetPositionChange')).toBe(true);
      events.unsubscribe();
    });
  });

  describe('working constraints', () => {
    it('should create working constraints when drawing an ellipse, and convert into actual constraints on completion', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Make sure working constraints are created
      expect(geometryStore.workingConstraints).toHaveLength(2);

      // Move cursor further out
      toolManager.handleMouseMove(new ScreenPosition(30, 40), viewport);

      // Make sure working constraints update:
      expect(geometryStore.workingConstraints).toHaveLength(2);
      // First working constraint is center -> radiusX
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      // Second working constraing is center -> radiusY
      expect((geometryStore.workingConstraints[1].pointA as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointA as any).point.y).toBeCloseTo(
        30 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.x).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      // Update the first working constraint (radiusX) to be 100cm
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse now has the constrained radiusX
      // In corner mode, constrained radius is applied as 2*radiusX offset from firstPoint
      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 200, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 1);

      // Click to create the ellipse
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the ellipse was added
      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(1);
      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      // In corner mode, center is computed from firstPoint and previewPoint
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(100, 1);

      // Also make sure a constraint was added for radiusX
      const constraints = geometryStore.listWithComponent(ConstraintComponent);
      expect(constraints).toHaveLength(1);
      const constraint = ConstraintComponent.get(constraints[0]) as LinearConstraintData;
      expect(constraint.constrainedLength.type).toStrictEqual(CentimetersType);
      expect(constraint.constrainedLength.magnitude).toStrictEqual(100);
      expect((constraint.pointA as any).type).toStrictEqual('locked-ellipse');
      expect((constraint.pointA as any).point).toStrictEqual('center');
      expect((constraint.pointA as any).id).toStrictEqual(ellipse.id);
      expect((constraint.pointB as any).type).toStrictEqual('locked-ellipse');
      expect((constraint.pointB as any).point).toStrictEqual('right');
      expect((constraint.pointB as any).id).toStrictEqual(ellipse.id);
    });

    it('should be able to constrain both radii of an ellipse', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Update both working constraints
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        { ...old[1], constrainedLength: new CentimetersLength(50) },
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse is now 100x50 (in terms of radii)
      // In corner mode, previewPoint is bounding box corner = center + radius
      // center = firstPoint + radius, so previewPoint = firstPoint + 2*radius
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 200, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 100, 1);

      // The user can move the cursor all they want...
      toolManager.handleMouseMove(new ScreenPosition(999, 555), viewport);

      // ... but the size still stays the same
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 200, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 100, 1);

      // Click to create the ellipse
      toolManager.handleMouseDown(new ScreenPosition(31, 41), viewport);

      // Make sure the ellipse was added
      expect(geometryStore.listWithComponent(EllipseComponent)).toHaveLength(1);
      const ellipse = geometryStore.listWithComponent(EllipseComponent)[0];
      expect(EllipseComponent.get(ellipse).radiusX).toBeCloseTo(100, 1);
      expect(EllipseComponent.get(ellipse).radiusY).toBeCloseTo(50, 1);

      // Also make sure both constraints were added
      const constraintsList = geometryStore.listWithComponent(ConstraintComponent);
      expect(constraintsList).toHaveLength(2);
      const radiusXConstraint = ConstraintComponent.get(constraintsList[0]);
      expect((radiusXConstraint.pointA as any).type).toStrictEqual('locked-ellipse');
      expect((radiusXConstraint.pointA as any).point).toStrictEqual('center');
      expect((radiusXConstraint.pointA as any).id).toStrictEqual(ellipse.id);
      expect((radiusXConstraint.pointB as any).type).toStrictEqual('locked-ellipse');
      expect((radiusXConstraint.pointB as any).point).toStrictEqual('right');
      expect((radiusXConstraint.pointB as any).id).toStrictEqual(ellipse.id);
      const radiusYConstraint = ConstraintComponent.get(constraintsList[1]);
      expect((radiusYConstraint.pointA as any).type).toStrictEqual('locked-ellipse');
      expect((radiusYConstraint.pointA as any).point).toStrictEqual('center');
      expect((radiusYConstraint.pointA as any).id).toStrictEqual(ellipse.id);
      expect((radiusYConstraint.pointB as any).type).toStrictEqual('locked-ellipse');
      expect((radiusYConstraint.pointB as any).point).toStrictEqual('top');
      expect((radiusYConstraint.pointB as any).id).toStrictEqual(ellipse.id);
    });

    it('should be able to constrain both radii of an ellipse and place it in any quadrant', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(0, 0), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Update both working constraints
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        { ...old[1], constrainedLength: new CentimetersLength(50) },
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(30, 40), viewport);

      // Make sure working ellipse is now 100x50 (in terms of radii)
      // In corner mode, previewPoint is bounding box corner = center + radius
      // center = firstPoint + radius, so previewPoint = firstPoint + 2*radius
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(100 * 2, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(50 * 2, 1);

      // Move the cursor to each quadrant, and make sure the ellipse wholly lies in each
      for (const [cursorX, cursorY] of [
        [50, 50],
        [50, -50],
        [-50, 50],
        [-50, -50],
      ]) {
        toolManager.handleMouseMove(new ScreenPosition(cursorX, cursorY), viewport);

        we = geometryStore.workingEllipse;
        expect(we).not.toBeNull();
        if (cursorX > 0) {
          expect(we!.previewPoint!.x).toBeGreaterThan(0);
        } else {
          expect(we!.previewPoint!.x).toBeLessThan(0);
        }
        if (cursorY > 0) {
          expect(we!.previewPoint!.y).toBeGreaterThan(0);
        } else {
          expect(we!.previewPoint!.y).toBeLessThan(0);
        }
      }
    });

    it('should be able to reset a constraint after setting it', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Update the first working constraint to be 100cm
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse is now constrained
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 200, 1);

      // Reset first working constraint to be unset
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: null },
        ...old.slice(1),
      ]);

      // Move the mouse again
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse is back to being unconstrained
      // But it should still be constrained to the last position before reset since mouse hasn't moved
      // The constraint reset means no radius constraint, so preview = mouse position
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(31 / SHEET_UNITS_TO_PIXELS, 1);
    });

    it('should ensure the constraints are set around the center when alt is held', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Press and hold alt
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);

      // Update the first working constraint (radiusX) to be 100cm wide
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse is now 100cm radiusX, centered on firstPoint
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.isCenterMode).toStrictEqual(true);
      // In center mode, firstPoint is the center, so previewPoint should be at center.x + 100
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 1);
    });

    it('should ensure the radiusX constraint applies to both dimensions when shift is held (circular)', () => {
      // Click to start ellipse
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Update the first working constraint (radiusX) to be 100cm
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // Make sure working ellipse is now 100cm radiusX, and as tall as the mouse dictates
      // In corner mode with constrained radiusX, previewPoint = firstPoint + 2*radiusX for X
      // Y should be unconstrained and follow the mouse position
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 200, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 1);

      // Press and hold shift
      toolManager.handleKeyDown({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the second working constraint is now disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(CentimetersType);
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        100 /* left side radius */ + 10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        100 /* top side radius */ + 20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        100 /* left side radius */ + 10 / SHEET_UNITS_TO_PIXELS + 100 /* right side radius */,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        100 /* top side radius */ + 20 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      expect(geometryStore.workingConstraints[1].type).toStrictEqual('linear');
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(true);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      expect((geometryStore.workingConstraints[1].pointA as any).point.x).toBeCloseTo(
        100 /* left side radius */ + 10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointA as any).point.y).toBeCloseTo(
        100 /* top side radius */ + 20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.x).toBeCloseTo(
        100 /* left side radius */ + 10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS /* at top edge of ellipse */,
        2,
      );

      // Also make sure both dimensions are 100cm radius (circular means both radii = 100)
      // In circular mode, previewPoint = center + radiusX, and center = firstPoint + radiusX in corner mode
      // So previewPoint = firstPoint + 2*radiusX = firstPoint + 200
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(100 + 10 / SHEET_UNITS_TO_PIXELS + 100, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(100 + 20 / SHEET_UNITS_TO_PIXELS + 100, 1);

      // Release shift
      toolManager.handleKeyUp({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the working ellipse height is now back to matching the mouse position
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.y).toBeCloseTo(42 / SHEET_UNITS_TO_PIXELS, 1);

      // And that both working constraints are no longer disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(false);
    });

    it('should ensure the radiusX constraint applies circularly in center mode (alt + shift)', () => {
      // Click to start ellipse (in corner mode initially)
      toolManager.handleMouseDown(new ScreenPosition(10, 20), viewport);
      expect(geometryStore.workingEllipse).not.toBeNull();

      // Press alt to switch to center mode
      toolManager.handleKeyDown({ key: 'Alt', altKey: true } as KeyboardEvent);

      // Update the first working constraint (radiusX) to be 100cm
      expect(geometryStore.workingConstraints).toHaveLength(2);
      geometryStore.setWorkingConstraints((old) => [
        { ...old[0], constrainedLength: new CentimetersLength(100) },
        ...old.slice(1),
      ]);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(31, 41), viewport);

      // In center mode, previewPoint = center + radiusX = firstPoint + 100
      // Y is unconstrained and follows the mouse
      let we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.isCenterMode).toStrictEqual(true);
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(41 / SHEET_UNITS_TO_PIXELS, 1);

      // Press and hold shift
      toolManager.handleKeyDown({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the second working constraint is now disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].type).toStrictEqual('linear');
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength
          ?.magnitude,
      ).toStrictEqual(100);
      expect(
        (geometryStore.workingConstraints[0] as WorkingLinearConstraint).constrainedLength?.type,
      ).toStrictEqual(CentimetersType);
      // In center mode, center = firstPoint = (10/SHEET_UNITS_TO_PIXELS, 20/SHEET_UNITS_TO_PIXELS)
      // Working constraint 0 is center -> right (+100 in X, same Y as center)
      expect((geometryStore.workingConstraints[0].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointA as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS + 100,
        2,
      );
      expect((geometryStore.workingConstraints[0].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );

      expect(geometryStore.workingConstraints[1].type).toStrictEqual('linear');
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(true);
      expect(
        (geometryStore.workingConstraints[1] as WorkingLinearConstraint).constrainedLength,
      ).toBeNull();
      // Working constraint 1 is center -> bottom (-100 in Y, same X as center)
      expect((geometryStore.workingConstraints[1].pointA as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointA as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.x).toBeCloseTo(
        10 / SHEET_UNITS_TO_PIXELS,
        2,
      );
      expect((geometryStore.workingConstraints[1].pointB as any).point.y).toBeCloseTo(
        20 / SHEET_UNITS_TO_PIXELS - 100,
        2,
      );

      // In center mode with shift, preview = center + (radius, radius) = firstPoint + (100, 100)
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.x).toBeCloseTo(10 / SHEET_UNITS_TO_PIXELS + 100, 1);
      expect(we!.previewPoint!.y).toBeCloseTo(20 / SHEET_UNITS_TO_PIXELS + 100, 1);

      // Release shift
      toolManager.handleKeyUp({ key: 'Shift', shiftKey: true } as KeyboardEvent);

      // Move the mouse to get the constraint to apply
      // FIXME: remove this, this shouldn't be a requirement
      toolManager.handleMouseMove(new ScreenPosition(32, 42), viewport);

      // Make sure that the working ellipse height is now back to matching the mouse position
      we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();
      expect(we!.previewPoint!.y).toBeCloseTo(42 / SHEET_UNITS_TO_PIXELS, 1);

      // And that both working constraints are no longer disabled
      expect(geometryStore.workingConstraints).toHaveLength(2);
      expect(geometryStore.workingConstraints[0].disabled).toStrictEqual(false);
      expect(geometryStore.workingConstraints[1].disabled).toStrictEqual(false);
    });
  });

  describe('ctrl disables snapping', () => {
    it('preview is not snapped to grid when ctrl is held', () => {
      toolManager.setSnappingOptions({ primaryGridSize: 10, secondaryGridSize: null });

      toolManager.handleKeyDown({ key: 'Control', ctrlKey: true } as KeyboardEvent);

      // Click at (4, 3) in sheet units — would snap to (0, 0) with grid=10
      toolManager.handleMouseDown(
        new ScreenPosition(4 * SHEET_UNITS_TO_PIXELS, 3 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      // Move to (15, 25) — would snap to (20, 30) with grid=10
      toolManager.handleMouseMove(
        new ScreenPosition(15 * SHEET_UNITS_TO_PIXELS, 25 * SHEET_UNITS_TO_PIXELS),
        viewport,
      );

      toolManager.handleKeyUp({ key: 'Control', ctrlKey: true } as KeyboardEvent);

      const we = geometryStore.workingEllipse;
      expect(we).not.toBeNull();

      // Should NOT be snapped when ctrl is held
      expect(we!.firstPoint!.x).toBeCloseTo(4, 2);
      expect(we!.firstPoint!.y).toBeCloseTo(3, 2);
      expect(we!.previewPoint!.x).toBeCloseTo(15, 2);
      expect(we!.previewPoint!.y).toBeCloseTo(25, 2);
    });
  });
});
