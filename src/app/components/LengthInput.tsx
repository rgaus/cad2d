"use client";

import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Lengths, type Length, InchesLength, FeetLength, MillimetersLength, CentimetersLength, MetersLength } from "@/lib/units/length";
import { Input } from "@/components/ui/input";
import { HoverTooltip } from "./HoverTooltip";
import { KeyboardShortcut } from "./KeyboardShortcut";
import { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";
import { round } from "@/lib/math";

export type UnitOption = "in" | "ft" | "mm" | "cm" | "m";

export const UNIT_OPTIONS: Array<{ value: UnitOption; label: string }> = [
  { value: "in", label: "in" },
  { value: "ft", label: "ft" },
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
  { value: "m", label: "m" },
];

export function getUnitFromLength(length: Length | null): UnitOption {
  if (length === null) {
    // FIXME: make this default sheet unit
    return 'cm';
  }
  if (length instanceof InchesLength) { return "in"; }
  if (length instanceof FeetLength) { return "ft"; }
  if (length instanceof MillimetersLength) { return "mm"; }
  if (length instanceof CentimetersLength) { return "cm"; }
  if (length instanceof MetersLength) { return "m"; }
  return "cm";
}

export function createLengthFromMagnitudeAndUnit(magnitude: number, unit: UnitOption): Length {
  switch (unit) {
    case "in": return Lengths.inches(magnitude);
    case "ft": return Lengths.feet(magnitude);
    case "mm": return Lengths.mm(magnitude);
    case "cm": return Lengths.centimeters(magnitude);
    case "m": return Lengths.meters(magnitude);
  }
}

export function parseSuffix(text: string): { valid: boolean; magnitude: number; unit: UnitOption | null } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { valid: false, magnitude: 0, unit: null };
  }

  const match = trimmed.match(/^([\d.]+)\s*([a-zA-Z'"]*)$/);
  if (!match) {
    const parsed = parseFloat(text);
    if (!Number.isNaN(parsed)) {
      return { valid: true, magnitude: parsed, unit: null };
    } else {
      return { valid: false, magnitude: 0, unit: null };
    }
  }

  const magnitude = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();

  if (suffix === "in" || suffix === "inch" || suffix === "inches" || suffix === '"') {
    return { valid: true, magnitude, unit: "in" };
  }
  if (suffix === "f" || suffix === "ft" || suffix === "foot" || suffix === "feet" || suffix === "'") {
    return { valid: true, magnitude, unit: "ft" };
  }
  if (suffix === "mm" || suffix === "millimeter" || suffix === "millimeters") {
    return { valid: true, magnitude, unit: "mm" };
  }
  if (suffix === "c" || suffix === "cm" || suffix === "centimeter" || suffix === "centimeters") {
    return { valid: true, magnitude, unit: "cm" };
  }
  if (suffix === "me" || suffix === "met" || suffix === "mete" || suffix === "meter" || suffix === "meters") {
    return { valid: true, magnitude, unit: "m" };
  }

  return { valid: true, magnitude, unit: null };
}

type LengthInputProps = {
  value: Length | null;
  onChange: (length: Length) => void;
  /** The number of places that `value` should be initially rounded to. Prevents displaying long
   * decimals due to floating point math errors. */
  roundPlaces?: number;
  onFocus?: () => void;
  onBlur?: () => void;
};

export type LengthInputHandle = {
  focus: () => void;
  select: () => void;
  setDisplayValue: (length: Length) => void;
};

export default forwardRef<LengthInputHandle, LengthInputProps>(function LengthInput({
  value,
  onChange,
  onFocus,
  onBlur,
  roundPlaces = 5,
}, ref) {
  const [inputValue, setInputValue] = useState(() => value ? value.magnitude.toString() : '');
  const [selectedUnit, setSelectedUnit] = useState<UnitOption>(() => getUnitFromLength(value));
  
  const inputRef = useRef<HTMLInputElement>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  const valueUnit = getUnitFromLength(value);
  const reset = useCallback(() => {
    if (value) {
      setInputValue(`${typeof roundPlaces === 'number' ? round(value.magnitude, roundPlaces) : value.magnitude}`);
    } else {
      setInputValue('');
    }
    setSelectedUnit(valueUnit);
  }, [value?.magnitude, valueUnit]);
  useEffect(() => reset(), [reset]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    select: () => inputRef.current?.select(),
    setDisplayValue: (length: Length) => {
      if (inputRef.current) {
        inputRef.current.value = length.magnitude.toString();
      }
      setSelectedUnit(getUnitFromLength(length));
    },
  }), []);

  const handleUnitChange = useCallback((newUnit: UnitOption) => {
    setSelectedUnit(newUnit);
    const parsed = parseSuffix(inputValue);
    const magnitude = parsed.magnitude || 0;
    onChange(createLengthFromMagnitudeAndUnit(magnitude, newUnit));
  }, [inputValue, onChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value;
    setInputValue(newInput);
  }, []);

  const [inputFocused, setInputFocused] = useState(false);
  const handleFocus = useCallback(() => {
    onFocus?.();
    setInputFocused(true);
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    onBlur?.();
    setInputFocused(false);

    const parsed = parseSuffix(inputValue);
    const cleanMagnitude = parsed.magnitude.toString();
    setInputValue(cleanMagnitude);

    const outputUnit = parsed.unit ?? selectedUnit;
    setSelectedUnit(outputUnit);
    const output = createLengthFromMagnitudeAndUnit(
      parsed.magnitude,
      outputUnit,
    );
    onChange(output);
  }, [inputValue, selectedUnit, onChange, onBlur]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
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
        const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const currentVal = parseSuffix(inputValue).magnitude;
        const newVal = currentVal + step;
        setInputValue(newVal.toString());
        onChange(createLengthFromMagnitudeAndUnit(newVal, selectedUnit));
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const currentVal = parseSuffix(inputValue).magnitude;
        const newVal = Math.max(0, currentVal - step);
        setInputValue(newVal.toString());
        onChange(createLengthFromMagnitudeAndUnit(newVal, selectedUnit));
        break;
      }
    }
  }, [handleBlur, reset, inputValue, selectedUnit, onChange, shiftHeld, altHeld]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Shift' && shiftHeld) {
      setShiftHeld(false);
    }
    if (e.key === 'Alt' && altHeld) {
      setAltHeld(false);
    }
  }, [shiftHeld, altHeld]);

  return (
    <div className="flex relative gap-1">
      <Input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className="grow shrink w-0 min-w-[64px]"
      />
      <Select value={selectedUnit} onValueChange={(value) => handleUnitChange(value as UnitOption)}>
        <SelectTrigger className="w-14">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNIT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {inputFocused ? (
        <div className="absolute -bottom-7 z-30">
          <HoverTooltip>
            <div className="flex items-center gap-2">
              <KeyboardShortcut disabled={shiftHeld} label={<>&plusmn;<span style={{ paddingLeft: 1 }}/>10</>}>shift</KeyboardShortcut>
              <KeyboardShortcut disabled={altHeld} label={<>&plusmn;<span style={{ paddingLeft: 1 }}/>0.1</>}>alt</KeyboardShortcut>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
    </div>
  );
});
