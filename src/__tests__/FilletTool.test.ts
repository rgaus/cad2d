import { ActionsManager } from '@/lib/actions/ActionsManager';
import { ConstraintEndpoint, PointSegment, Polygon, Rectangle } from '@/lib/entity';
import { GeometryStore, ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { DEFAULT_COLOR } from '@/lib/entity/colors';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { FilletFilter, FilletFilterData } from '@/lib/entity/filters/fillet';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { subscribeToEvents } from '@/lib/subscribe-to-events';
import { CornerState } from '@/lib/tools/BaseCornerGeometryReplacerTool';
import { FilletTool } from '@/lib/tools/FilletTool';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { CentimetersType, Length } from '@/lib/units/length';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { ScreenPosition, SheetPosition, type ViewportState } from '@/lib/viewport/types';

function makePoint(x: number, y: number): PointSegment {
  return { type: 'point', point: new SheetPosition(x, y) };
}

function sheetToScreen(x: number, y: number, viewport: ViewportState): ScreenPosition {
  return new SheetPosition(x, y).toWorld().toScreen(viewport);
}

describe('FilletTool', () => {
  let sheet: Sheet;
  let historyManager: HistoryManager;
  let geometryStore: GeometryStore;
  let selectionManager: SelectionManager;
  let actionsManager: ActionsManager;
  let toolManager: ToolManager;
  let viewport: ViewportState;
  let filletTool: FilletTool;
  let viewportControls: ViewportControls;

  beforeEach(() => {
    sheet = Sheet.a4();
    historyManager = new HistoryManager();
    geometryStore = new GeometryStore(historyManager);
    historyManager.setGeometryStore(geometryStore);
    selectionManager = new SelectionManager();
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    actionsManager = new ActionsManager(sheet, geometryStore, selectionManager, historyManager);
    historyManager.setGeometryStore(geometryStore);
    toolManager = new ToolManager(geometryStore, selectionManager, historyManager);
    toolManager.setSerializationManager(
      new SerializationManager(actionsManager, toolManager, sheet),
    );

    viewportControls = new ViewportControls({
      canvasWidth: 800,
      canvasHeight: 600,
      sheet,
    });
    toolManager.setViewportControls(viewportControls);
    viewport = viewportControls.getState().viewport;

    toolManager.setActiveTool('edit');
    toolManager.changeToolSubTool('edit', 'fillet');
    filletTool = toolManager.getTool('edit').activeSubTool as FilletTool;
  });

  describe('Rectangle corner clicks create filters', () => {
    let rect: Rectangle;
    beforeEach(() => {
      rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );
    });

    it.each(['upperRight', 'lowerRight', 'lowerLeft', 'upperLeft'] as const)(
      '%s corner',
      (cornerLabel) => {
        const endpoint = ConstraintEndpoint.lockedToRectangle(rect.id, cornerLabel);
        const pos = geometryStore.resolveConstraintEndpoint(endpoint);
        if (!pos) {
          throw new Error(`Could not resolve corner ${cornerLabel}`);
        }

        // Click the given corner
        toolManager.handleMouseMove(sheetToScreen(pos.x, pos.y, viewport), viewport);
        toolManager.handleMouseDown(sheetToScreen(pos.x, pos.y, viewport), viewport);

        // Enter an offset distance, and commit
        filletTool.onChangeCurrentOffset(Length.centimeters(20));
        filletTool.commit();

        // Make sure filter was added
        const filters = geometryStore.listWithComponent(FilterComponent);
        expect(filters).toHaveLength(1);

        // Make sure filter is centered at `centerEndpoint`
        const filter = FilterComponent.get(filters[0]);
        expect(filter.type).toStrictEqual('fillet');
        expect((filter as FilletFilterData).geometryType).toStrictEqual('rectangle');
        expect((filter as any).pointCenterKeyPoint).toStrictEqual(cornerLabel);
        expect(
          (filter as FilletFilterData).offset.toSheetUnits(sheet.defaultUnit).magnitude,
        ).toBeCloseTo(20);
      },
    );

    it('two corners in sequence', () => {
      // First corner: upperRight
      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);
      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      let filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(1);
      expect((FilterComponent.get(filters[0]) as any).pointCenterKeyPoint).toBe('upperRight');

      // Second corner: lowerRight
      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);
      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(2);
    });
  });

  describe('Commit and click interaction', () => {
    let rect: Rectangle;
    beforeEach(() => {
      rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );
    });

    it('clicking before current corner commits filter and activates new corner', async () => {
      const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

      // Click to add a fillet on the lower right point
      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);

      // Set a length, but do NOT commit it
      filletTool.onChangeCurrentOffset(Length.centimeters(20));

      events.clearBufferedEvents();

      // Now hover / click on the upper left corner (before lower right)
      toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(0, 0, viewport), viewport);

      // The first corner's filter should have been committed
      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(1);
      expect((FilterComponent.get(filters[0]) as any).pointCenterKeyPoint).toBe('lowerRight');

      // The second fillet gets made active
      // First a no-op event from the abort in commit:
      let event = await events.waitFor<CornerState | null>('activeCornerChange');
      expect(event).toBeNull();
      // Then the actual event:
      event = await events.waitFor<CornerState | null>('activeCornerChange');
      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.centerEndpoint).toStrictEqual('upperLeft');

      // And the current offset length should have persisted
      expect(filletTool.currentOffset?.type).toStrictEqual(CentimetersType);
      expect(filletTool.currentOffset?.magnitude).toStrictEqual(20);
    });

    it('clicking after current corner commits filter and activates new corner', async () => {
      const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

      // Click to add a fillet on the lower right point
      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 100, viewport), viewport);

      // Set a length, but do NOT commit it
      filletTool.onChangeCurrentOffset(Length.centimeters(20));

      events.clearBufferedEvents();

      // Now hover / click on the lower left corner (after lower right)
      toolManager.handleMouseMove(sheetToScreen(0, 100, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(0, 100, viewport), viewport);

      // The first corner's filter should have been committed
      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(1);
      expect((FilterComponent.get(filters[0]) as any).pointCenterKeyPoint).toBe('lowerRight');

      // The second fillet gets made active
      // First a no-op event from the abort in commit:
      let event = await events.waitFor<CornerState | null>('activeCornerChange');
      expect(event).toBeNull();
      // Then the actual event:
      event = await events.waitFor<CornerState | null>('activeCornerChange');
      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.centerEndpoint).toStrictEqual('lowerLeft');

      // And the current offset length should have persisted
      expect(filletTool.currentOffset?.type).toStrictEqual(CentimetersType);
      expect(filletTool.currentOffset?.magnitude).toStrictEqual(20);
    });
  });

  describe('Polygon corner clicks create filters', () => {
    it('middle point of a closed triangular polygon', () => {
      const { id: polygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
          closed: true,
        }),
      );

      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(1);
      const filter = FilterComponent.get(filters[0]);
      expect(filter.type).toStrictEqual('fillet');
      expect((filter as FilletFilterData).geometryType).toStrictEqual('polygon');
      expect((filter as FilletFilterData).geometryId).toStrictEqual(polygonId);
      expect((filter as any).pointCenterIndex).toStrictEqual(1);
    });

    it('starting point of a closed triangular polygon', () => {
      const { id: polygonId } = geometryStore.addOrdered(
        ID_PREFIXES.polygon,
        Polygon.create(
          [makePoint(100, 0), makePoint(100, 100), makePoint(0, 0), makePoint(100, 0)],
          { closed: true },
        ),
      );

      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);

      filletTool.onChangeCurrentOffset(Length.centimeters(20));
      filletTool.commit();

      const filters = geometryStore.listWithComponent(FilterComponent);
      expect(filters).toHaveLength(1);
      const filter = FilterComponent.get(filters[0]);
      expect(filter.type).toBe('fillet');
      expect((filter as FilletFilterData).geometryType).toBe('polygon');
      expect((filter as FilletFilterData).geometryId).toStrictEqual(polygonId);
      expect((filter as any).pointCenterIndex).toBe(0);
    });
  });

  describe('hover behavior', () => {
    let rect: Rectangle;
    beforeEach(() => {
      rect = geometryStore.addOrdered(
        ID_PREFIXES.rectangle,
        Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
          fillColor: DEFAULT_COLOR,
          linkDimensions: false,
        }),
      );
    });

    it('should allow hovering over all rectangle corner points', async () => {
      const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

      // Hover over upper left
      toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
      let event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.pointAEndpoint).toStrictEqual('lowerLeft');
      expect(event?.pointAPos.x).toStrictEqual(0);
      expect(event?.pointAPos.y).toStrictEqual(100);
      expect(event?.centerEndpoint).toStrictEqual('upperLeft');
      expect(event?.centerPos.x).toStrictEqual(0);
      expect(event?.centerPos.y).toStrictEqual(0);
      expect(event?.pointBEndpoint).toStrictEqual('upperRight');
      expect(event?.pointBPos.x).toStrictEqual(100);
      expect(event?.pointBPos.y).toStrictEqual(0);

      // Hover over upper right
      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.pointAEndpoint).toStrictEqual('lowerRight');
      expect(event?.pointAPos.x).toStrictEqual(100);
      expect(event?.pointAPos.y).toStrictEqual(100);
      expect(event?.centerEndpoint).toStrictEqual('upperRight');
      expect(event?.centerPos.x).toStrictEqual(100);
      expect(event?.centerPos.y).toStrictEqual(0);
      expect(event?.pointBEndpoint).toStrictEqual('upperLeft');
      expect(event?.pointBPos.x).toStrictEqual(0);
      expect(event?.pointBPos.y).toStrictEqual(0);

      // Hover over lower right
      toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);
      event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.pointAEndpoint).toStrictEqual('lowerLeft');
      expect(event?.pointAPos.x).toStrictEqual(0);
      expect(event?.pointAPos.y).toStrictEqual(100);
      expect(event?.centerEndpoint).toStrictEqual('lowerRight');
      expect(event?.centerPos.x).toStrictEqual(100);
      expect(event?.centerPos.y).toStrictEqual(100);
      expect(event?.pointBEndpoint).toStrictEqual('upperRight');
      expect(event?.pointBPos.x).toStrictEqual(100);
      expect(event?.pointBPos.y).toStrictEqual(0);

      // Hover over lower left
      toolManager.handleMouseMove(sheetToScreen(0, 100, viewport), viewport);
      event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.pointAEndpoint).toStrictEqual('lowerRight');
      expect(event?.pointAPos.x).toStrictEqual(100);
      expect(event?.pointAPos.y).toStrictEqual(100);
      expect(event?.centerEndpoint).toStrictEqual('lowerLeft');
      expect(event?.centerPos.x).toStrictEqual(0);
      expect(event?.centerPos.y).toStrictEqual(100);
      expect(event?.pointBEndpoint).toStrictEqual('upperLeft');
      expect(event?.pointBPos.x).toStrictEqual(0);
      expect(event?.pointBPos.y).toStrictEqual(0);
    });

    it('should disallow hovering over active rectangle corner points', async () => {
      const events = subscribeToEvents(filletTool, ['pendingCornerChange', 'activeCornerChange']);

      // Hovering over upper left works
      toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
      let event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.centerEndpoint).toStrictEqual('upperLeft');

      // Click to make upper left the active point
      toolManager.handleMouseDown(sheetToScreen(0, 0, viewport), viewport);

      // And make sure an activeCornerChange event is emitted
      event = await events.waitFor<CornerState | null>('activeCornerChange');
      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.centerEndpoint).toStrictEqual('upperLeft');

      // Now, hovering over the upper right point should still work
      toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
      event = await events.waitFor<CornerState | null>('pendingCornerChange');

      expect(event?.mode).toStrictEqual('rectangle');
      if (event?.mode !== 'rectangle') {
        throw new Error('not rectangle');
      }
      expect(event?.centerEndpoint).toStrictEqual('upperRight');

      // But not the upper left, since it is active
      toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
      expect(events.areThereBufferedEvents('activeCornerChange')).toBeFalsy();
    });
  });

  it('should not be able to place a fillet on a point where one side is arc-cubic / arc-quadratic', async () => {
    const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

    geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create(
        [
          makePoint(0, 0),
          {
            type: 'arc-quadratic',
            point: new SheetPosition(100, 100),
            controlPoint: new SheetPosition(50, 50),
          },
          makePoint(0, 100),
        ],
        { closed: true },
      ),
    );

    toolManager.handleMouseMove(sheetToScreen(100, 100, viewport), viewport);

    expect(await events.waitFor('pendingCornerChange')).toBeNull();
  });

  it('should disallow hovering over rectangle corner points with previously attached fillets', async () => {
    const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

    // Create a new rectangle
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100), {
        fillColor: DEFAULT_COLOR,
        linkDimensions: false,
      }),
    );

    // Add a fillet centered on the upperLeft point of the rectangle
    geometryStore.add(
      ID_PREFIXES.filter,
      FilletFilter.createOnRectangle(
        rectangle.id,
        'lowerLeft',
        'upperLeft',
        'upperRight',
        Length.centimeters(20),
      ),
    );

    // Hovering over upper left does nothing
    toolManager.handleMouseMove(sheetToScreen(0, 0, viewport), viewport);
    expect(await events.waitFor<CornerState | null>('pendingCornerChange')).toBeNull();
  });

  it('should disallow hovering over polygon vertex points with previously attached fillets', async () => {
    const events = subscribeToEvents(filletTool, ['pendingCornerChange']);

    // Create a new polygon
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
        closed: true,
      }),
    );

    // Add a fillet centered on the upperLeft point of the rectangle
    geometryStore.add(
      ID_PREFIXES.filter,
      FilletFilter.createOnPolygon(polygon.id, 0, 1, 2, Length.centimeters(20)),
    );

    // Hovering over point at index=1 does nothing
    toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
    expect(await events.waitFor<CornerState | null>('pendingCornerChange')).toBeNull();
  });

  it('should disallow adding another fillet on top of a polygon point with a fillet already', async () => {
    // Create a new polygon
    const rectangle = geometryStore.addOrdered(
      ID_PREFIXES.rectangle,
      Rectangle.create(new SheetPosition(0, 0), new SheetPosition(100, 100)),
    );

    // Add a fillet centered on the upperLeft point of the rectangle
    geometryStore.add(
      ID_PREFIXES.filter,
      FilletFilter.createOnRectangle(rectangle.id, 'upperLeft', 'upperRight', 'lowerRight', Length.centimeters(20)),
    );

    // Simulate attempting to add another filler - hover over, click, and enter offset
    toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
    toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);
    filletTool.onChangeCurrentOffset(Length.centimeters(20));
    filletTool.commit();

    // Make sure that after this there is only one fillet (ie, the original one)
    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(1);
  });

  it('should disallow adding another fillet on top of a polygon point with a fillet already', async () => {
    // Create a new polygon
    const polygon = geometryStore.addOrdered(
      ID_PREFIXES.polygon,
      Polygon.create([makePoint(0, 0), makePoint(100, 0), makePoint(100, 100), makePoint(0, 0)], {
        closed: true,
      }),
    );

    // Add a fillet centered on the upperLeft point of the rectangle
    geometryStore.add(
      ID_PREFIXES.filter,
      FilletFilter.createOnPolygon(polygon.id, 0, 1, 2, Length.centimeters(20)),
    );

    // Simulate attempting to add another filler - hover over, click, and enter offset
    toolManager.handleMouseMove(sheetToScreen(100, 0, viewport), viewport);
    toolManager.handleMouseDown(sheetToScreen(100, 0, viewport), viewport);
    filletTool.onChangeCurrentOffset(Length.centimeters(20));
    filletTool.commit();

    // Make sure that after this there is only one fillet (ie, the original one)
    expect(geometryStore.listWithComponent(FilterComponent)).toHaveLength(1);
  });
});
