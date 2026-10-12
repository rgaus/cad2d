'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  AnchorDotGrid,
  ELLIPSE_ANCHOR_DOTS,
  RECTANGLE_ANCHOR_DOTS,
} from '@/components/ui/AnchorDotGrid';
import EntitySelectionInput from './EntitySelectionInput';
import LabeledRow from '@/components/ui/LabeledRow';
import LengthInput from '@/components/ui/LengthInput';
import { Length } from '@/lib/units/length';

const MONO_STYLE = {
  fontFamily: 'var(--font-roboto-mono), monospace',
};

const ENDPOINT_TYPE_OPTIONS = [
  { value: 'point', label: 'Point' },
  { value: 'locked-rectangle', label: 'Rect' },
  { value: 'locked-ellipse', label: 'Ellipse' },
  { value: 'locked-polygon', label: 'Polygon' },
  { value: 'locked-datum', label: 'Datum' },
] as const;

type EndpointType = (typeof ENDPOINT_TYPE_OPTIONS)[number]['value'];

type ConstraintEndpointInputProps = {
  label: string;
};

/** A composite editor for a constraint endpoint. Lets a user switch between the free-floating
 *  `point` variant and the `locked-*` variants. For locked endpoints, an entity selector picks
 *  the referenced geometry and an anchor dot grid / index control specifies the exact point on it. */
const ConstraintEndpointInput: React.FunctionComponent<ConstraintEndpointInputProps> = ({
  label,
}) => {
  const [type, setType] = useState<EndpointType>('point');
  const [x, setX] = useState<Length>(Length.centimeters(3));
  const [y, setY] = useState<Length>(Length.centimeters(4));
  const [entityId, setEntityId] = useState<string | null>('ply_9f3a1c');
  const [anchor, setAnchor] = useState<string>('upperLeft');
  const [index, setIndex] = useState('0');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1 w-full">
        <span className="text-[var(--slate-12)] text-sm font-medium select-none" style={MONO_STYLE}>
          {label}:
        </span>
        <Select value={type} onValueChange={(value) => setType(value as EndpointType)}>
          <SelectTrigger className="w-28">
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
        {type === 'point' ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <LengthInput value={x} onChange={setX} readOnlyUnit />
            </div>
            <div className="flex-1 min-w-0">
              <LengthInput value={y} onChange={setY} readOnlyUnit />
            </div>
          </div>
        ) : null}

        {type === 'locked-rectangle' || type === 'locked-ellipse' ? (
          <>
            <EntitySelectionInput
              value={entityId}
              clearable
              isPicking={false}
              onActivatePick={() => {}}
              onCancel={() => {}}
              onClear={() => setEntityId(null)}
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--slate-11)] select-none" style={MONO_STYLE}>
                anchor:
              </span>
              <AnchorDotGrid
                value={anchor}
                dots={type === 'locked-rectangle' ? RECTANGLE_ANCHOR_DOTS : ELLIPSE_ANCHOR_DOTS}
                onChange={setAnchor}
              />
            </div>
          </>
        ) : null}

        {type === 'locked-polygon' ? (
          <>
            <EntitySelectionInput
              value={entityId}
              clearable
              isPicking={false}
              onActivatePick={() => {}}
              onCancel={() => {}}
              onClear={() => setEntityId(null)}
            />
            <LabeledRow label="Index:">
              <Input
                type="number"
                min={0}
                value={index}
                onChange={(e) => setIndex(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </LabeledRow>
          </>
        ) : null}

        {type === 'locked-datum' ? (
          <EntitySelectionInput
            value={entityId}
            clearable
            isPicking={false}
            onActivatePick={() => {}}
            onCancel={() => {}}
            onClear={() => setEntityId(null)}
          />
        ) : null}
      </div>
    </div>
  );
};

export default ConstraintEndpointInput;