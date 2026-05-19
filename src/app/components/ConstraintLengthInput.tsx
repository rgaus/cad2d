"use client";

import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { type Length } from "@/lib/units/length";
import { Input } from "@/components/ui/input";
import { round } from "@/lib/math";
import { cn } from "@/lib/utils";
import { createLengthFromMagnitudeAndUnit, getUnitFromLength, parseSuffix, UNIT_OPTIONS, type UnitOption } from "./LengthInput";

type ConstraintLengthInputProps = {
  value: Length | null;
  placeholder?: string;
  onChange: (length: Length | null) => void;
  /** The number of places that `value` should be initially rounded to. Prevents displaying long
   * decimals due to floating point math errors. */
  roundPlaces?: number;
  onFocus?: () => void;
  onBlur?: () => void;
  onTabPress?: () => void;
};

export type ConstraintLengthInputHandle = {
  focus: () => void;
  select: () => void;
  setDisplayValue: (length: Length) => void;
};

export default forwardRef<ConstraintLengthInputHandle, ConstraintLengthInputProps>(function LengthInput({
  value,
  placeholder,
  onChange,
  onFocus,
  onBlur,
  onTabPress,
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

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setInputValue(inputValue);

    if (inputValue.length === 0) {
      onChange(null);
      return;
    }

    const parsed = parseSuffix(inputValue);
    if (!parsed.valid) {
      setInputValue(inputValue);
      return;
    }

    const outputUnit = parsed.unit ?? selectedUnit;
    setSelectedUnit(outputUnit);
    const output = createLengthFromMagnitudeAndUnit(
      parsed.magnitude,
      outputUnit,
    );
    onChange(output);
  }, []);

  const handleFocus = useCallback(() => {
    onFocus?.();
  }, [onFocus]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Shift' && !shiftHeld) {
      setShiftHeld(true);
    }
    if (e.key === 'Alt' && !altHeld) {
      setAltHeld(true);
    }

    switch (e.key) {
      case 'Tab': {
        if (onTabPress) {
          e.preventDefault();
          onTabPress();
          return;
        }
        break;
      }
      case 'Backspace':
      case 'Delete': {
        // NOTE: without this, backspace will delete the selected geometry / etc
        e.stopPropagation();
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
  }, [inputValue, selectedUnit, onChange, shiftHeld, altHeld, onTabPress]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Shift' && shiftHeld) {
      setShiftHeld(false);
    }
    if (e.key === 'Alt' && altHeld) {
      setAltHeld(false);
    }
  }, [shiftHeld, altHeld]);

  return (
    <div className="flex relative">
      <Input
        ref={inputRef}
        type="text"
        fieldSize="sm"
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={cn(
          "grow shrink w-0 placeholder-[var(--slate-2)]",
          "min-w-[48px] border-2 border-r-0 rounded-r-none",
          "border-[var(--slate-5)] bg-white hover:bg-[var(--slate-12)] focus:bg-[var(--slate-12)] text-[var(--slate-3)] focus:border-[var(--slate-8)]",
        )}
        tabIndex={0}
      />
      <div
        className={cn(
          "flex h-6 w-full items-center justify-between rounded-[4px] border border-2 text-xs",
          "p-1 text-sm outline-none transition-colors placeholder:text-[var(--slate-7)]",
          "border-[var(--slate-5)] bg-white focus:bg-[var(--slate-12)] text-[var(--slate-8)] focus:border-[var(--slate-8)]",
          "border-l-0 rounded-l-none",
        )}
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {UNIT_OPTIONS.find((opt) => opt.value === selectedUnit)?.label}
      </div>
    </div>
  );
});
