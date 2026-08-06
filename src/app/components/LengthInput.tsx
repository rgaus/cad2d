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
import {
  CentimetersLength,
  FeetLength,
  InchesLength,
  Length,
  MetersLength,
  MillimetersLength,
  UnitType,
} from '@/lib/units/length';
import { HoverTooltip } from './HoverTooltip';
import { KeyboardShortcut } from './KeyboardShortcut';

export const UNIT_OPTIONS: Array<{ value: UnitType; label: string }> = [
  { value: 'in', label: 'in' },
  { value: 'ft', label: 'ft' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
];

export function getUnitFromLength(length: Length | null): UnitType {
  if (length === null) {
    // FIXME: make this default sheet unit
    return 'cm';
  }
  if (length instanceof InchesLength) {
    return 'in';
  }
  if (length instanceof FeetLength) {
    return 'ft';
  }
  if (length instanceof MillimetersLength) {
    return 'mm';
  }
  if (length instanceof CentimetersLength) {
    return 'cm';
  }
  if (length instanceof MetersLength) {
    return 'm';
  }
  return 'cm';
}

export function createLengthFromMagnitudeAndUnit(magnitude: number, unit: UnitType): Length {
  switch (unit) {
    case 'in':
      return Length.inches(magnitude);
    case 'ft':
      return Length.feet(magnitude);
    case 'mm':
      return Length.millimeters(magnitude);
    case 'cm':
      return Length.centimeters(magnitude);
    case 'm':
      return Length.meters(magnitude);
  }
}

const LENGTH_UNIT_SUFFIXES = {
  in: ['in', 'inch', 'inches', '"'],
  ft: ['f', 'ft', 'foot', 'feet', "'"],
  mm: ['mm', 'millimeter', 'millimeters'],
  cm: ['c', 'cm', 'centimeter', 'centimeters'],
  m: ['me', 'met', 'mete', 'meter', 'meters'],
};

export type ParsedSuffixOutput<U> = {
  valid: boolean;
  magnitude: number;
  unit: U | null;
};

/** Special case: feet and inches formatted like `5' 3"` */
const feetInchesSpecialCase = (trimmed: string) => {
  const feetInchesMatch = trimmed.match(
    /^([\d.]+)\s*(?:f|ft|feet|foot|')\s*([\d.]+)\s*(?:in|inch|inches|")$/,
  );
  if (!feetInchesMatch) {
    return null;
  }

  const inches = parseFloat(feetInchesMatch[1] /* feet */) * 12 + parseFloat(feetInchesMatch[2]);
  if (!Number.isNaN(inches)) {
    return { valid: true, magnitude: inches, unit: 'in' as const };
  }
  return null;
};

/** Parse the given input, extracting a magnitude and unit suffix. */
export function parseSuffix<Unit extends string>(
  text: string,
  unitToSuffixes: Record<Unit, Array<string>>,
  specialCases: Array<(trimmed: string) => ParsedSuffixOutput<Unit> | null> = [],
): ParsedSuffixOutput<Unit> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { valid: false, magnitude: 0, unit: null };
  }

  const match = trimmed.match(/^([\d.]+)\s*([a-zA-Z'"]*)$/);
  if (!match) {
    // If the base case didn't match, try any special cases
    for (const specialCase of specialCases) {
      const output = specialCase(trimmed);
      if (output) {
        return output;
      }
    }

    const parsed = parseFloat(text);
    if (!Number.isNaN(parsed)) {
      return { valid: true, magnitude: parsed, unit: null };
    } else {
      return { valid: false, magnitude: 0, unit: null };
    }
  }

  const magnitude = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();

  for (const unit of Object.keys(unitToSuffixes)) {
    const suffixOptions = unitToSuffixes[unit as Unit];
    if (suffixOptions.includes(suffix)) {
      return { valid: true, magnitude, unit: unit as Unit };
    }
  }

  return { valid: true, magnitude, unit: null };
}

const parseLengthSuffix = (text: string) =>
  parseSuffix<UnitType>(text, LENGTH_UNIT_SUFFIXES, [feetInchesSpecialCase]);

type LengthInputProps = {
  value: Length | null;
  onChange: (length: Length) => void;
  /** The number of places that `value` should be initially rounded to. Prevents displaying long
   * decimals due to floating point math errors. */
  roundPlaces?: number;
  readOnlyUnit?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
};

export type LengthInputHandle = {
  focus: () => void;
  select: () => void;
  setDisplayValue: (length: Length) => void;
};

export default forwardRef<LengthInputHandle, LengthInputProps>(function LengthInput(
  { value, onChange, onFocus, onBlur, roundPlaces = 5, readOnlyUnit = false },
  ref,
) {
  const [inputDefaultValue, setInputDefaultValue] = useState(() =>
    value ? `${round(value.magnitude, roundPlaces)}` : '',
  );
  const [selectedUnit, setSelectedUnit] = useState<UnitType>(() => getUnitFromLength(value));

  const inputRef = useRef<HTMLInputElement>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  const valueUnit = getUnitFromLength(value);
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
      setDisplayValue: (length: Length) => {
        if (inputRef.current) {
          inputRef.current.value = `${round(length.magnitude, roundPlaces)}`;
        }
        setSelectedUnit(getUnitFromLength(length));
      },
    }),
    [roundPlaces],
  );

  const handleUnitChange = useCallback(
    (newUnit: UnitType) => {
      setSelectedUnit(newUnit);
      const parsed = parseLengthSuffix(inputDefaultValue);
      const magnitude = parsed.magnitude || 0;
      onChange(createLengthFromMagnitudeAndUnit(magnitude, newUnit));
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

    const parsed = parseLengthSuffix(inputDefaultValue);
    const cleanMagnitude = parsed.magnitude.toString();
    setInputDefaultValue(cleanMagnitude);
    if (inputRef.current) {
      inputRef.current.value = cleanMagnitude;
    }

    const outputUnit = parsed.unit ?? selectedUnit;
    setSelectedUnit(outputUnit);
    const output = createLengthFromMagnitudeAndUnit(parsed.magnitude, outputUnit);
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
          const currentVal = parseLengthSuffix(inputDefaultValue).magnitude;
          const newVal = currentVal + step;
          if (inputRef.current) {
            inputRef.current.value = newVal.toString();
          }
          setInputDefaultValue(newVal.toString());
          onChange(createLengthFromMagnitudeAndUnit(newVal, selectedUnit));
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const step = e.shiftKey ? 10 : e.altKey && roundPlaces >= 1 ? 0.1 : 1;
          const currentVal = parseLengthSuffix(inputDefaultValue).magnitude;
          const newVal = Math.max(0, currentVal - step);
          if (inputRef.current) {
            inputRef.current.value = newVal.toString();
          }
          setInputDefaultValue(newVal.toString());
          onChange(createLengthFromMagnitudeAndUnit(newVal, selectedUnit));
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
        <Select value={selectedUnit} onValueChange={(value) => handleUnitChange(value as UnitType)}>
          <SelectTrigger className="w-14">
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
        <div className="absolute -bottom-7 z-30">
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
