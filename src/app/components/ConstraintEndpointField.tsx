'use client';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useEntities } from '@/hooks/useEntities';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { DatumComponent } from '@/lib/entity/components/DatumComponent';
import { GeometryComponent } from '@/lib/entity/components/GeometryComponent';
import { ConstraintEndpoint } from '@/lib/entity/constraints';
import { type EllipseEndpoint } from '@/lib/entity/ellipse';
import { type RectangleEndpoint } from '@/lib/entity/rectangle';
import { Length, type UnitType } from '@/lib/units/length';
import { cn } from '@/lib/utils';
import { SheetPosition } from '@/lib/viewport/types';
import EntityInput from './EntityInput';
import LabeledRow from './LabeledRow';
import LengthInput from './LengthInput';

const ENDPOINT_TYPE_OPTIONS = [
  { value: 'point', label: 'Point' },
  { value: 'locked-rectangle', label: 'Rect' },
  { value: 'locked-ellipse', label: 'Ellipse' },
  { value: 'locked-polygon', label: 'Polygon' },
  { value: 'locked-datum', label: 'Datum' },
] as const;

/** A cell within the 3x3 anchor dot grid. */
type AnchorDotPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right';

/** A single selectable anchor dot mapping a keypoint value to its grid position. */
type AnchorDot<V extends string> = { value: V; position: AnchorDotPosition };

type AnchorDotGridProps<V extends string> = {
  /** Currently-selected keypoint value. */
  value: V;
  /** The keypoint dots to render, each mapped to a position within the 3x3 grid. */
  dots: Array<AnchorDot<V>>;
  onChange: (value: V) => void;
};

/** Ordered positions of the 3x3 anchor dot grid (row-major). */
const ANCHOR_GRID_POSITIONS: Array<AnchorDotPosition> = [
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
const RECTANGLE_ANCHOR_DOTS: Array<AnchorDot<RectangleEndpoint>> = [
  { value: 'upperLeft', position: 'top-left' },
  { value: 'upperRight', position: 'top-right' },
  { value: 'lowerRight', position: 'bottom-right' },
  { value: 'lowerLeft', position: 'bottom-left' },
  { value: 'center', position: 'center' },
];

/** Ellipse keypoints drawn as a cross (four cardinals plus center). */
const ELLIPSE_ANCHOR_DOTS: Array<AnchorDot<EllipseEndpoint>> = [
  { value: 'top', position: 'top' },
  { value: 'right', position: 'right' },
  { value: 'bottom', position: 'bottom' },
  { value: 'left', position: 'left' },
  { value: 'center', position: 'center' },
];

/** A compact 3x3 dot grid for picking a keypoint / anchor on a shape, similar to InDesign's
 *  reference point picker. Cells without a dot render as empty spacers so the active dots sit at
 *  their intended positions (e.g. corners for a rectangle, cardinals for an ellipse). */
function AnchorDotGrid<V extends string>({ value, dots, onChange }: AnchorDotGridProps<V>) {
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

type ConstraintEndpointFieldProps = {
  label: string;
  endpoint: ConstraintEndpoint;
  onChange: (next: ConstraintEndpoint) => void;
  geometryStore: GeometryStore;
  sheetUnitPlaces: number;
  sheetDefaultUnit: UnitType;
};

/** A composite editor for a {@link ConstraintEndpoint}. Lets a user switch between the free-floating
 *  `point` variant and the `locked-*` variants. For locked endpoints, an {@link EntityInput} selects
 *  the referenced geometry and an anchor dot grid / index control specifies the exact point on it. */
const ConstraintEndpointField: React.FunctionComponent<ConstraintEndpointFieldProps> = ({
  label,
  endpoint,
  onChange,
  geometryStore,
  sheetUnitPlaces,
  sheetDefaultUnit,
}) => {
  const rectangles = useEntities(geometryStore, (g) =>
    g.listWithComponent(GeometryComponent).filter((e) => GeometryComponent.isRectangle(e)),
  );
  const ellipses = useEntities(geometryStore, (g) =>
    g.listWithComponent(GeometryComponent).filter((e) => GeometryComponent.isEllipse(e)),
  );
  const polygons = useEntities(geometryStore, (g) =>
    g.listWithComponent(GeometryComponent).filter((e) => GeometryComponent.isPolygon(e)),
  );
  const datums = useEntities(geometryStore, (g) => g.listWithComponent(DatumComponent));

  const handleTypeChange = (nextType: string) => {
    switch (nextType) {
      case 'point':
        onChange(
          ConstraintEndpoint.point(
            geometryStore.resolveConstraintEndpoint(endpoint) ?? new SheetPosition(0, 0),
          ),
        );
        return;
      case 'locked-rectangle':
        if (rectangles.length > 0) {
          onChange(ConstraintEndpoint.lockedToRectangle(rectangles[0].id, 'upperLeft'));
        }
        return;
      case 'locked-ellipse':
        if (ellipses.length > 0) {
          onChange(ConstraintEndpoint.lockedToEllipse(ellipses[0].id, 'top'));
        }
        return;
      case 'locked-polygon':
        if (polygons.length > 0) {
          onChange(ConstraintEndpoint.lockedToPolygon(polygons[0].id, 0));
        }
        return;
      case 'locked-datum':
        if (datums.length > 0) {
          onChange(ConstraintEndpoint.lockedToDatum(datums[0].id));
        }
        return;
    }
  };

  const handlePointXChange = (len: Length) => {
    if (endpoint.type !== 'point') {
      return;
    }
    onChange(
      ConstraintEndpoint.point(
        new SheetPosition(len.toSheetUnits(sheetDefaultUnit).magnitude, endpoint.point.y),
      ),
    );
  };

  const handlePointYChange = (len: Length) => {
    if (endpoint.type !== 'point') {
      return;
    }
    onChange(
      ConstraintEndpoint.point(
        new SheetPosition(endpoint.point.x, len.toSheetUnits(sheetDefaultUnit).magnitude),
      ),
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1 w-full">
        <span
          className="text-[var(--slate-12)] text-sm font-medium select-none"
          style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        >
          {label}:
        </span>
        <Select value={endpoint.type} onValueChange={handleTypeChange}>
          <SelectTrigger fieldSize="sm" className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENDPOINT_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5 pl-2">
        {endpoint.type === 'point' ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <LengthInput
                value={Length.fromSheetUnits(sheetDefaultUnit, endpoint.point.x)}
                onChange={handlePointXChange}
                roundPlaces={sheetUnitPlaces}
                readOnlyUnit
              />
            </div>
            <div className="flex-1 min-w-0">
              <LengthInput
                value={Length.fromSheetUnits(sheetDefaultUnit, endpoint.point.y)}
                onChange={handlePointYChange}
                roundPlaces={sheetUnitPlaces}
                readOnlyUnit
              />
            </div>
          </div>
        ) : null}

        {endpoint.type === 'locked-rectangle' ? (
          <>
            <EntityInput
              value={endpoint.id}
              entities={rectangles}
              onChange={(id) => onChange(ConstraintEndpoint.lockedToRectangle(id, endpoint.point))}
            />
            <div className="flex items-center gap-2">
              <span
                className="text-xs text-[var(--slate-11)] select-none"
                style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
              >
                anchor:
              </span>
              <AnchorDotGrid
                value={endpoint.point}
                dots={RECTANGLE_ANCHOR_DOTS}
                onChange={(next) =>
                  onChange(ConstraintEndpoint.lockedToRectangle(endpoint.id, next))
                }
              />
            </div>
          </>
        ) : null}

        {endpoint.type === 'locked-ellipse' ? (
          <>
            <EntityInput
              value={endpoint.id}
              entities={ellipses}
              onChange={(id) => onChange(ConstraintEndpoint.lockedToEllipse(id, endpoint.point))}
            />
            <div className="flex items-center gap-2">
              <span
                className="text-xs text-[var(--slate-11)] select-none"
                style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
              >
                Anchor:
              </span>
              <AnchorDotGrid
                value={endpoint.point}
                dots={ELLIPSE_ANCHOR_DOTS}
                onChange={(next) => onChange(ConstraintEndpoint.lockedToEllipse(endpoint.id, next))}
              />
            </div>
          </>
        ) : null}

        {endpoint.type === 'locked-polygon' ? (
          <>
            <EntityInput
              value={endpoint.id}
              entities={polygons}
              onChange={(id) =>
                onChange(ConstraintEndpoint.lockedToPolygon(id, endpoint.pointIndex))
              }
            />
            <LabeledRow label="Index:">
              <Input
                type="number"
                min={0}
                value={endpoint.pointIndex}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 0) {
                    onChange(ConstraintEndpoint.lockedToPolygon(endpoint.id, val));
                  }
                }}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </LabeledRow>
          </>
        ) : null}

        {endpoint.type === 'locked-datum' ? (
          <EntityInput
            value={endpoint.id}
            entities={datums}
            onChange={(id) => onChange(ConstraintEndpoint.lockedToDatum(id))}
          />
        ) : null}
      </div>
    </div>
  );
};

export default ConstraintEndpointField;
