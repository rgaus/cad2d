'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PLATFORM_ALT_KEY_STRING } from '@/lib/detection';
import { round } from '@/lib/math';
import { Angle, AngleType, DegreesAngle, RadiansAngle } from '@/lib/units/angle';
import { cn } from '@/lib/utils';
import { HoverTooltip } from './HoverTooltip';
import { KeyboardShortcut } from './KeyboardShortcut';
import { parseSuffix } from './LengthInput';

export const UNIT_OPTIONS: Array<{ value: AngleType; label: string }> = [
  { value: 'degrees', label: 'deg' },
  { value: 'radians', label: 'rad' },
];

const ANGLE_UNIT_SUFFIXES = {
  degrees: [
    'd',
    'deg',
    'degs',
    'degree',
    'degrees',
    String.fromCharCode(176) /* unicode degree symbol */,
  ],
  radians: ['rad', 'rads', 'radian', 'radians'],
};

const parseAngleSuffix = (text: string) => parseSuffix<AngleType>(text, ANGLE_UNIT_SUFFIXES);

export function getUnitFromAngle(angle: Angle | null): AngleType {
  if (angle === null) {
    // FIXME: make this default sheet angle unit
    return 'degrees';
  }
  if (angle instanceof DegreesAngle) {
    return 'degrees';
  }
  if (angle instanceof RadiansAngle) {
    return 'radians';
  }
  return 'degrees';
}

export function createAngleFromMagnitudeAndUnit(magnitude: number, unit: AngleType): Angle {
  switch (unit) {
    case 'degrees':
      return Angle.degrees(magnitude);
    case 'radians':
      return Angle.radians(magnitude);
  }
}

const AngleSpinner: React.FunctionComponent<{
  angle: Angle;
  onScrubAngle: (angle: Angle) => void;
  onBlur: () => void;
}> = ({ angle, onScrubAngle, onBlur }) => {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [shiftHeld, setShiftHeld] = useState(false);

  const [workingAngle, setWorkingAngle] = useState(angle);
  useEffect(() => setWorkingAngle(angle), [angle]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      setDragging(true);
      setShiftHeld(e.shiftKey);

      let value = 0;
      const onMouseMove = (e: MouseEvent) => {
        value += e.movementY;

        const unit = getUnitFromAngle(angle);
        let scaleFactor, maxValue, snapInterval: number | null;
        switch (unit) {
          case 'degrees':
            scaleFactor = 1;
            maxValue = 360;
            snapInterval = !e.shiftKey ? 45 : null;
            break;
          case 'radians':
            scaleFactor = 20;
            maxValue = 2 * Math.PI;
            snapInterval = !e.shiftKey ? Math.PI / 4 : null;
            break;
        }

        // Convert pixel value to angle, adjust to be within range, and apply snap
        let current = value / scaleFactor;
        while (current < 0) {
          current += maxValue;
        }
        while (current > maxValue) {
          current -= maxValue;
        }
        if (typeof snapInterval === 'number') {
          current = Math.round(current / snapInterval) * snapInterval;
        }

        // Emit to parent context
        const currentAngle = Angle.fromSheetUnits(unit, current);
        setWorkingAngle(currentAngle);
        onScrubAngle(currentAngle);
      };

      window.addEventListener('mousemove', onMouseMove);

      const onKeyDownUp = (e: KeyboardEvent) => {
        setShiftHeld(e.shiftKey);
      };
      window.addEventListener('keydown', onKeyDownUp);
      window.addEventListener('keyup', onKeyDownUp);

      const onMouseUp = () => {
        setDragging(false);
        onBlur();

        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('keydown', onKeyDownUp);
        window.removeEventListener('keyup', onKeyDownUp);
      };

      window.addEventListener('mouseup', onMouseUp);
    },
    [angle],
  );

  return (
    <div className="flex justify-center items-center w-8 h-8">
      {/* Backdrop to apply `cursor: ns-resize;` while dragging. */}
      {dragging ? <div className="fixed inset-0 cursor-ns-resize" /> : null}

      <button
        className={cn(
          'relative bg-[var(--slate-4)] border border-[var(--slate-5)] rounded-full w-6 h-6 cursor-ns-resize',
          {
            'border-[var(--slate-8)]': hover,
            'border-[var(--slate-10)]': dragging,
          },
        )}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onMouseDown={onMouseDown}
      >
        <div
          className={cn('absolute top-1/2 left-1/2 w-1/2 h-[1px] bg-[var(--slate-8)] rotate-90', {
            'h-[2px]': hover || dragging,
            'bg-[var(--slate-12)]': dragging,
          })}
          style={{
            transformOrigin: 'center left',
            rotate: `${workingAngle.toDegrees().magnitude - 90}deg`,
          }}
        />
      </button>

      {dragging ? (
        <div className="absolute -bottom-7 left-0 z-30">
          <HoverTooltip>
            <div className="flex items-center gap-2">
              <KeyboardShortcut disabled={shiftHeld} label="No snap">
                shift
              </KeyboardShortcut>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
    </div>
  );
};

type AngleInputProps = {
  value: Angle | null;
  onChange: (angle: Angle) => void;
  /** The number of places that `value` should be initially rounded to. Prevents displaying long
   * decimals due to floating point math errors. */
  roundPlaces?: number;
  readOnlyUnit?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
};

export type AngleInputHandle = {
  focus: () => void;
  select: () => void;
  setDisplayValue: (angle: Angle) => void;
};

export default forwardRef<AngleInputHandle, AngleInputProps>(function LengthInput(
  { value, onChange, onFocus, onBlur, roundPlaces = 5, readOnlyUnit = false },
  ref,
) {
  const [inputDefaultValue, setInputDefaultValue] = useState(() =>
    value ? `${round(value.magnitude, roundPlaces)}` : '',
  );
  const [selectedUnit, setSelectedUnit] = useState<AngleType>(() => getUnitFromAngle(value));

  const inputRef = useRef<HTMLInputElement>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  const valueUnit = getUnitFromAngle(value);
  const reset = useCallback(() => {
    if (!inputRef.current) {
      return;
    }
    if (value) {
      inputRef.current.value = `${typeof roundPlaces === 'number' ? round(value.magnitude, roundPlaces) : value.magnitude}`;
      setInputDefaultValue(inputRef.current.value);
    } else {
      inputRef.current.value = '';
      setInputDefaultValue('');
    }
    setSelectedUnit(valueUnit);
  }, [value?.magnitude, valueUnit]);
  useEffect(() => reset(), [reset]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      select: () => inputRef.current?.select(),
      setDisplayValue: (angle: Angle) => {
        if (inputRef.current) {
          inputRef.current.value = `${round(angle.magnitude, roundPlaces)}`;
        }
        setSelectedUnit(getUnitFromAngle(angle));
      },
    }),
    [roundPlaces],
  );

  const handleUnitChange = useCallback(
    (newUnit: AngleType) => {
      setSelectedUnit(newUnit);
      const parsed = parseAngleSuffix(inputDefaultValue);
      const magnitude = parsed.magnitude || 0;
      onChange(createAngleFromMagnitudeAndUnit(magnitude, newUnit));
    },
    [inputDefaultValue, onChange],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value;
    setInputDefaultValue(newInput);
  }, []);

  const [inputFocused, setInputFocused] = useState(false);
  const handleFocus = useCallback(() => {
    onFocus?.();
    setInputFocused(true);
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    onBlur?.();
    setInputFocused(false);

    const parsed = parseAngleSuffix(inputDefaultValue);
    const cleanMagnitude = parsed.magnitude.toString();
    setInputDefaultValue(cleanMagnitude);
    if (inputRef.current) {
      inputRef.current.value = cleanMagnitude;
    }

    const outputUnit = parsed.unit ?? selectedUnit;
    setSelectedUnit(outputUnit);
    const output = createAngleFromMagnitudeAndUnit(parsed.magnitude, outputUnit);
    onChange(output);
  }, [inputDefaultValue, selectedUnit, onChange, onBlur]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // NOTE: without this, backspace will delete the selected geometry / etc
      e.stopPropagation();

      if (e.key === 'Shift' && !shiftHeld) {
        setShiftHeld(true);
      }
      if (e.key === 'Alt' && !altHeld) {
        setAltHeld(true);
      }

      switch (e.key) {
        case 'Enter': {
          inputRef.current?.blur();
          break;
        }
        case 'Escape': {
          reset();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : e.altKey && roundPlaces >= 1 ? 0.1 : 1;
          const currentVal = parseAngleSuffix(inputDefaultValue).magnitude;
          const newVal = currentVal + step;
          if (inputRef.current) {
            inputRef.current.value = newVal.toString();
          }
          setInputDefaultValue(newVal.toString());
          onChange(createAngleFromMagnitudeAndUnit(newVal, selectedUnit));
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : e.altKey && roundPlaces >= 1 ? 0.1 : 1;
          const currentVal = parseAngleSuffix(inputDefaultValue).magnitude;
          const newVal = Math.max(0, currentVal - step);
          if (inputRef.current) {
            inputRef.current.value = newVal.toString();
          }
          setInputDefaultValue(newVal.toString());
          onChange(createAngleFromMagnitudeAndUnit(newVal, selectedUnit));
          break;
        }
      }
    },
    [handleBlur, reset, inputDefaultValue, selectedUnit, onChange, shiftHeld, altHeld],
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Shift' && shiftHeld) {
        setShiftHeld(false);
      }
      if (e.key === 'Alt' && altHeld) {
        setAltHeld(false);
      }
    },
    [shiftHeld, altHeld],
  );

  return (
    <div className="flex relative gap-1">
      {value ? (
        <AngleSpinner angle={value} onScrubAngle={console.log} onBlur={console.log} />
      ) : null}

      <Input
        ref={inputRef}
        type="text"
        defaultValue={inputDefaultValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className="grow shrink w-0 min-w-[64px]"
      />
      {readOnlyUnit ? (
        <div className="flex items-center text-sm select-none pl-1">
          <span>{UNIT_OPTIONS.find((opt) => opt.value === selectedUnit)?.label}</span>
        </div>
      ) : (
        <Select
          value={selectedUnit}
          onValueChange={(value) => handleUnitChange(value as AngleType)}
        >
          <SelectTrigger className="w-18">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {inputFocused ? (
        <div className="absolute -bottom-7 left-9 z-30">
          <HoverTooltip>
            <div className="flex items-center gap-2">
              <KeyboardShortcut
                disabled={shiftHeld}
                label={
                  <>
                    &plusmn;
                    <span style={{ paddingLeft: 1 }} />
                    10
                  </>
                }
              >
                shift
              </KeyboardShortcut>
              {/* Hide alt+arrows when the roundPlaces value is not large enough to support it */}
              {roundPlaces >= 1 ? (
                <KeyboardShortcut
                  disabled={altHeld}
                  label={
                    <>
                      &plusmn;
                      <span style={{ paddingLeft: 1 }} />
                      0.1
                    </>
                  }
                >
                  {PLATFORM_ALT_KEY_STRING}
                </KeyboardShortcut>
              ) : null}
            </div>
          </HoverTooltip>
        </div>
      ) : null}
    </div>
  );
});
