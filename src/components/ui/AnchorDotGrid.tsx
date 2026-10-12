'use client';

import { cn } from '@/lib/utils';

export type AnchorDotPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

export type AnchorDot<V extends string = string> = {
  value: V;
  position: AnchorDotPosition;
};

/** Ordered positions of the 3x3 anchor dot grid (row-major). */
export const ANCHOR_GRID_POSITIONS: Array<AnchorDotPosition> = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
];

/** Rectangle keypoints drawn as a die "5" (four corners plus center). */
export const RECTANGLE_ANCHOR_DOTS: Array<AnchorDot<string>> = [
  { value: 'upperLeft', position: 'top-left' },
  { value: 'upperRight', position: 'top-right' },
  { value: 'lowerRight', position: 'bottom-right' },
  { value: 'lowerLeft', position: 'bottom-left' },
  { value: 'center', position: 'center' },
];

/** Ellipse keypoints drawn as a cross (four cardinals plus center). */
export const ELLIPSE_ANCHOR_DOTS: Array<AnchorDot<string>> = [
  { value: 'top', position: 'top' },
  { value: 'right', position: 'right' },
  { value: 'bottom', position: 'bottom' },
  { value: 'left', position: 'left' },
  { value: 'center', position: 'center' },
];

type AnchorDotGridProps<V extends string> = {
  /** Currently-selected keypoint value. */
  value: V;
  /** The keypoint dots to render, each mapped to a position within the 3x3 grid. */
  dots: Array<AnchorDot<V>>;
  onChange: (value: V) => void;
};

/** A compact 3x3 dot grid for picking a keypoint / anchor on a shape, similar to InDesign's
 *  reference point picker. Cells without a dot render as empty spacers so the active dots sit at
 *  their intended positions (e.g. corners for a rectangle, cardinals for an ellipse). */
export function AnchorDotGrid<V extends string>({
  value,
  dots,
  onChange,
}: AnchorDotGridProps<V>) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {ANCHOR_GRID_POSITIONS.map((position) => {
        const dot = dots.find((d) => d.position === position);
        if (!dot) {
          return <span key={position} className="w-4 h-4" />;
        }
        const active = dot.value === value;
        return (
          <button
            key={position}
            type="button"
            title={dot.value}
            aria-pressed={active}
            onClick={() => onChange(dot.value)}
            className={cn(
              'w-4 h-4 rounded-full border transition-colors',
              active
                ? 'bg-[var(--teal-9)] border-[var(--teal-9)]'
                : 'bg-[var(--slate-5)] border-[var(--slate-7)] hover:bg-[var(--slate-6)]',
            )}
          />
        );
      })}
    </div>
  );
}