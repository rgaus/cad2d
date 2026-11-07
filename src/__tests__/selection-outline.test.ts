import { OrientedBoundingBox } from '@/lib/math';
import { shouldShowSelectionOutline } from '@/lib/selection/resize-frame';
import { SheetPosition } from '@/lib/viewport/types';

describe('shouldShowSelectionOutline', () => {
  const rotatedBbox = {
    position: new SheetPosition(0, 0),
    width: 10,
    height: 4,
    angleDegrees: 30,
  };

  it('hides the outline when it only matches the rotated selection box bounds', () => {
    expect(shouldShowSelectionOutline(rotatedBbox, OrientedBoundingBox.toRect(rotatedBbox))).toBe(
      false,
    );
  });

  it('shows the outline when filter output extends beyond the selection box', () => {
    expect(
      shouldShowSelectionOutline(rotatedBbox, {
        position: new SheetPosition(-5, -5),
        width: 20,
        height: 15,
      }),
    ).toBe(true);
  });

  it('hides the outline when there is no selection or outline', () => {
    expect(shouldShowSelectionOutline(null, OrientedBoundingBox.toRect(rotatedBbox))).toBe(false);
    expect(shouldShowSelectionOutline(rotatedBbox, null)).toBe(false);
  });
});
