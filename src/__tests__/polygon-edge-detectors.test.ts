import { shouldRenderProximityEdgeDetectors } from '@/lib/renderer';
import { SheetPosition } from '@/lib/viewport/types';

const proximityAABB = {
  position: new SheetPosition(0, 0),
  width: 10,
  height: 10,
};

describe('shouldRenderProximityEdgeDetectors', () => {
  it('renders for open primary polygons with a nearby mouse', () => {
    expect(
      shouldRenderProximityEdgeDetectors({
        primary: true,
        closed: false,
        isSelected: false,
        mousePositionProximityAABB: proximityAABB,
      }),
    ).toBe(true);
  });

  it('does not render for closed polygons', () => {
    expect(
      shouldRenderProximityEdgeDetectors({
        primary: true,
        closed: true,
        isSelected: false,
        mousePositionProximityAABB: proximityAABB,
      }),
    ).toBe(false);
  });

  it('does not render for selected polygons', () => {
    expect(
      shouldRenderProximityEdgeDetectors({
        primary: true,
        closed: false,
        isSelected: true,
        mousePositionProximityAABB: proximityAABB,
      }),
    ).toBe(false);
  });

  it('does not render for non-primary polygons', () => {
    expect(
      shouldRenderProximityEdgeDetectors({
        primary: false,
        closed: false,
        isSelected: false,
        mousePositionProximityAABB: proximityAABB,
      }),
    ).toBe(false);
  });

  it('does not render without a mouse proximity box', () => {
    expect(
      shouldRenderProximityEdgeDetectors({
        primary: true,
        closed: false,
        isSelected: false,
        mousePositionProximityAABB: null,
      }),
    ).toBe(false);
  });
});
