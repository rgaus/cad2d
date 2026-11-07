'use client';

import { useEffect, useState } from 'react';
import AngleInput from '@/components/ui/AngleInput';
import { Button } from '@/components/ui/Button';
import ColorInput from '@/components/ui/ColorInput';
import FloatingPanel from '@/components/ui/FloatingPanel';
import { Input } from '@/components/ui/Input';
import LabeledRow from '@/components/ui/LabeledRow';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/ToggleGroup';
import {
  DEFAULT_GEAR_FILL_COLOR,
  GearGeneratorAction,
  GearGeneratorState,
  GearPitchMode,
} from '@/lib/actions/GearGeneratorAction';
import { Length } from '@/lib/units/length';

type GearGeneratorPanelProps = {
  action: GearGeneratorAction;
};

type NumberFieldProps = {
  value: number;
  onChange: (value: number) => void;
  trailing?: string;
  step?: number;
  min?: number;
  max?: number;
};

/** A numeric input that keeps its raw text while focused so partial input isn't overwritten. */
const NumberField: React.FunctionComponent<NumberFieldProps> = ({
  value,
  onChange,
  trailing,
  step,
  min,
  max,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? String(value);

  return (
    <Input
      type="number"
      value={displayValue}
      trailing={trailing}
      step={step ?? 'any'}
      min={min}
      max={max}
      onFocus={() => setDraft(String(value))}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onChange={(event) => {
        const nextText = event.currentTarget.value;
        setDraft(nextText);
        const parsed = parseFloat(nextText);
        if (Number.isFinite(parsed)) {
          onChange(parsed);
        }
      }}
    />
  );
};

const GearGeneratorPanel: React.FunctionComponent<GearGeneratorPanelProps> = ({ action }) => {
  const [state, setState] = useState<GearGeneratorState>(() => action.getState());

  useEffect(() => {
    const handleStateChange = (nextState: GearGeneratorState) => {
      setState(nextState);
    };
    action.on('stateChange', handleStateChange);
    return () => {
      action.off('stateChange', handleStateChange);
    };
  }, [action]);

  if (!state.panelVisible) {
    return null;
  }

  const sheet = action.getSheet();
  const metrics = state.metrics;
  const formatDiameter = (radius: number) =>
    Length.fromSheetUnits(sheet.defaultUnit, radius * 2).toDisplayString();

  return (
    <FloatingPanel title="Generate Gear" onClose={() => action.cancel()} className="w-[320px]">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Pitch mode:">
          <ToggleGroup
            type="single"
            value={state.params.pitchMode}
            onValueChange={(value) => {
              if (value) {
                action.setPitchMode(value as GearPitchMode);
              }
            }}
          >
            <ToggleGroupItem value="module" className="w-auto px-2 h-6 text-xs">
              Module
            </ToggleGroupItem>
            <ToggleGroupItem value="diametral-pitch" className="w-auto px-2 h-6 text-xs">
              D.P.
            </ToggleGroupItem>
          </ToggleGroup>
        </LabeledRow>

        <LabeledRow label={state.params.pitchMode === 'module' ? 'Module:' : 'Diametral pitch:'}>
          <NumberField
            value={state.params.pitch}
            onChange={(pitch) => action.updateParams({ pitch })}
            trailing={state.params.pitchMode === 'module' ? 'mm' : 'in⁻¹'}
            step={0.01}
            min={0.0001}
          />
        </LabeledRow>

        <LabeledRow label="Teeth:">
          <NumberField
            value={state.params.teeth}
            onChange={(teeth) => action.updateParams({ teeth })}
            step={1}
            min={3}
          />
        </LabeledRow>

        <LabeledRow label="Pressure angle:">
          <AngleInput
            value={state.params.pressureAngle}
            onChange={(pressureAngle) => action.updateParams({ pressureAngle })}
          />
        </LabeledRow>

        <LabeledRow label="Addendum:">
          <NumberField
            value={state.params.addendumCoefficient}
            onChange={(addendumCoefficient) => action.updateParams({ addendumCoefficient })}
            trailing="×m"
            step={0.01}
            min={0.0001}
          />
        </LabeledRow>

        <LabeledRow label="Dedendum:">
          <NumberField
            value={state.params.dedendumCoefficient}
            onChange={(dedendumCoefficient) => action.updateParams({ dedendumCoefficient })}
            trailing="×m"
            step={0.01}
            min={0.0001}
          />
        </LabeledRow>

        <LabeledRow label="Profile shift:">
          <NumberField
            value={state.params.profileShift}
            onChange={(profileShift) => action.updateParams({ profileShift })}
            trailing="×m"
            step={0.01}
          />
        </LabeledRow>

        <LabeledRow label="Backlash:">
          <NumberField
            value={state.params.backlash}
            onChange={(backlash) => action.updateParams({ backlash })}
            trailing="×m"
            step={0.01}
            min={0}
          />
        </LabeledRow>

        <LabeledRow label="Fill:">
          <ColorInput
            value={state.params.fillColor}
            onChange={(fillColor) =>
              action.updateParams({
                fillColor: fillColor ?? DEFAULT_GEAR_FILL_COLOR,
              })
            }
          />
        </LabeledRow>

        <div className="w-full h-[1px] bg-[var(--slate-6)] mt-1" />

        {metrics !== null ? (
          <div className="flex flex-col gap-0.5 text-xs text-[var(--slate-11)]">
            <span>Pitch Ø {formatDiameter(metrics.pitchRadius)}</span>
            <span>Outer Ø {formatDiameter(metrics.outerRadius)}</span>
            <span>Root Ø {formatDiameter(metrics.rootRadius)}</span>
          </div>
        ) : null}

        {state.validation.valid ? null : (
          <div className="text-xs text-[var(--red-9)]">{state.validation.errors[0]}</div>
        )}

        <div className="flex justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={() => action.cancel()}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            className="flex-1"
            disabled={!state.validation.valid}
            onClick={() => action.create()}
          >
            Create
          </Button>
        </div>
      </div>
    </FloatingPanel>
  );
};

export default GearGeneratorPanel;
