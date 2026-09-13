'use client';

import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useEntities } from '@/hooks/useEntities';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { DatumComponent } from '@/lib/entity/components/DatumComponent';
import { GeometryComponent } from '@/lib/entity/components/GeometryComponent';
import { ConstraintEndpoint } from '@/lib/entity/constraints';
import { Length, type UnitType } from '@/lib/units/length';
import { SheetPosition } from '@/lib/viewport/types';
import EntityInput from './EntityInput';
import LabeledRow from './LabeledRow';
import LengthInput from './LengthInput';

const ENDPOINT_TYPE_OPTIONS = [
  { value: 'point', label: 'Point' },
  { value: 'locked-rectangle', label: 'Rect' },
  { value: 'locked-ellipse', label: 'Ellipse' },
  { value: 'locked-polygon', label: 'Poly' },
  { value: 'locked-datum', label: 'Datum' },
] as const;

const RECTANGLE_KEYPOINTS = [
  'upperLeft',
  'upperRight',
  'lowerRight',
  'lowerLeft',
  'center',
] as const;

const ELLIPSE_KEYPOINTS = ['top', 'right', 'bottom', 'left', 'center'] as const;

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
 *  the referenced geometry and a keypoint / index control specifies the exact point on it. */
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

  const endpointType = endpoint.type;

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
        <ToggleGroup type="single" value={endpointType} onValueChange={handleTypeChange}>
          {ENDPOINT_TYPE_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value} className="w-auto px-2 h-6 text-xs">
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
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
            <ToggleGroup
              type="single"
              value={endpoint.point}
              onValueChange={(next) => {
                if (next) {
                  onChange(ConstraintEndpoint.lockedToRectangle(endpoint.id, next as never));
                }
              }}
            >
              {RECTANGLE_KEYPOINTS.map((kp) => (
                <ToggleGroupItem key={kp} value={kp} className="w-auto px-2 h-6 text-xs">
                  {kp}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </>
        ) : null}

        {endpoint.type === 'locked-ellipse' ? (
          <>
            <EntityInput
              value={endpoint.id}
              entities={ellipses}
              onChange={(id) => onChange(ConstraintEndpoint.lockedToEllipse(id, endpoint.point))}
            />
            <ToggleGroup
              type="single"
              value={endpoint.point}
              onValueChange={(next) => {
                if (next) {
                  onChange(ConstraintEndpoint.lockedToEllipse(endpoint.id, next as never));
                }
              }}
            >
              {ELLIPSE_KEYPOINTS.map((kp) => (
                <ToggleGroupItem key={kp} value={kp} className="w-auto px-2 h-6 text-xs">
                  {kp}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
