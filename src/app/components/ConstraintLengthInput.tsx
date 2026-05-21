"use client";

import { useState, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Length } from "@/lib/units/length";
import { Input } from "@/components/ui/input";
import { round } from "@/lib/math";
import { cn } from "@/lib/utils";
import { createLengthFromMagnitudeAndUnit, getUnitFromLength, parseSuffix, UNIT_OPTIONS, type UnitOption } from "./LengthInput";
import { HoverTooltip } from "./HoverTooltip";
import { KeyboardShortcut } from "./KeyboardShortcut";

type ConstraintLengthInputProps = {
  value: Length | null;
  placeholder?: string;
  onChange: (length: Length | null) => void;
  /** The number of places that `value` should be initially rounded to. Prevents displaying long
   * decimals due to floating point math errors. */
  roundPlaces?: number;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onTabPress?: () => void;
  defaultUnit: UnitOption;
};

export type ConstraintLengthInputHandle = {
  focus: () => void;
  isFocused: () => boolean;
  select: () => void;
};

function formatValueAsString(value: Length | null, includeUnit: boolean, roundPlaces?: number) {
  if (value === null) {
    return '';
  }

  const magnitudeFormatted = typeof roundPlaces === 'number' ? round(value.magnitude, roundPlaces) : value.magnitude;
  if (includeUnit) {
    const valueUnit = getUnitFromLength(value);
    const unitFormatted = UNIT_OPTIONS.find((opt) => opt.value === valueUnit)?.label;
    return `${magnitudeFormatted}${unitFormatted}`;
  } else {
    return `${magnitudeFormatted}`;
  }
}

export default forwardRef<ConstraintLengthInputHandle, ConstraintLengthInputProps>(function LengthInput({
  value,
  placeholder,
  onChange,
  onFocus,
  onBlur,
  onTabPress,
  roundPlaces = 5,
  disabled,
  defaultUnit,
}, ref) {
  const inputValueContainsUnitRef = useRef(getUnitFromLength(value) === defaultUnit);
  const [defaultUnitVisible, setDefaultUnitVisible] = useState(inputValueContainsUnitRef.current);
  // useEffect(() => {
  //   inputValueContainsUnitRef.current = getUnitFromLength(value) === defaultUnit;
  //   setDefaultUnitVisible(inputValueContainsUnitRef.current);
  // }, [defaultUnit])

  const [inputValue, setInputValue] = useState(() => formatValueAsString(value, inputValueContainsUnitRef.current));
  
  const inputRef = useRef<HTMLInputElement>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  const lastResetLengthRef = useRef<Length | null>(value);
  const reset = useCallback(() => {
    if (value) {
      // console.log('IN:', value, 'vs', lastResetLengthRef.current);
      if (value.magnitude === lastResetLengthRef.current?.magnitude && value.type === lastResetLengthRef?.current.type) {
        // Value didn't change from what is already in the field
        // So don't reset the field - this could take stuff like `10"` and convert to `10in`
        return;
      }
      lastResetLengthRef.current = value;

      setInputValue(formatValueAsString(value, inputValueContainsUnitRef.current, roundPlaces));
    } else {
      setInputValue('');
    }
  }, [value?.magnitude, value?.type, roundPlaces]);
  useEffect(() => reset(), [reset]);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    isFocused: () => document.activeElement === inputRef.current,
    select: () => inputRef.current?.select(),
  }), [inputValue]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    setInputValue(inputValue);

    if (inputValue.length === 0) {
      onChange(null);
      return;
    }

    const parsed = parseSuffix(inputValue);
    // console.log('OUT:', inputValue, '=>', parsed, parsed.unit !== getUnitFromLength(value));
    if (!parsed.valid) {
      return;
    }
    inputValueContainsUnitRef.current = parsed.unit ? parsed.unit !== getUnitFromLength(value) : false;
    setDefaultUnitVisible(!inputValueContainsUnitRef.current);

    const output = createLengthFromMagnitudeAndUnit(
      parsed.magnitude,
      parsed.unit ?? defaultUnit,
    );
    lastResetLengthRef.current = output;
    onChange(output);
  }, [value, defaultUnit]);

  const [inputFocused, setInputFocused] = useState(false);
  const handleFocus = useCallback(() => {
    onFocus?.();
    setInputFocused(true);
  }, [onFocus]);

  const handleBlur = useCallback(() => {
    onBlur?.();
    setInputFocused(false);
  }, [onBlur]);

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
      case 'Escape':
      case 'Enter':
      case 'Shift':
      case 'Alt': {
        // Let escape through, as this cancels the in flight geometry drawing
        // Let enter through, as this syncs working constraint values back to their shadowed constraint
        // Let shift / alt through, as these keys control shape creation mode logic (center + aspect ratio)
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const { magnitude: currentVal, unit } = parseSuffix(inputValue);
        const newVal = currentVal + step;
        setInputValue(newVal.toString());
        onChange(createLengthFromMagnitudeAndUnit(newVal, unit ?? defaultUnit));
        break;
      }
      case 'ArrowDown': {
        e.preventDefault();
        const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const { magnitude: currentVal, unit } = parseSuffix(inputValue);
        const newVal = Math.max(0, currentVal - step);
        setInputValue(newVal.toString());
        onChange(createLengthFromMagnitudeAndUnit(newVal, unit ?? defaultUnit));
        break;
      }
      default: {
        // Default to blocking keypresses
        // Otherwise stuff like ctrl+a will trigger actions, NOT select all text in the input
        e.stopPropagation();
        break;
      }
    }
  }, [inputValue, onChange, shiftHeld, altHeld, onTabPress, defaultUnit]);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Shift' && shiftHeld) {
      setShiftHeld(false);
    }
    if (e.key === 'Alt' && altHeld) {
      setAltHeld(false);
    }
  }, [shiftHeld, altHeld]);

  return (
    <div className={cn("flex relative bg-white rounded border border-2 border-[var(--slate-5)]", {
      "border-[var(--slate-8)] bg-[var(--slate-12)]": inputFocused,
    })}>
      <Input
        ref={inputRef}
        type="text"
        fieldSize="sm"
        placeholder={placeholder}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={cn(
          "min-w-[72px] grow shrink w-0 placeholder-[var(--slate-2)]",
          "border-0 outline-none",
          "bg-white hover:bg-[var(--slate-12)] focus:bg-[var(--slate-12)] text-[var(--slate-3)]",
          { "min-w-[48px]": defaultUnitVisible }
        )}
        tabIndex={0}
        disabled={disabled}
      />
      {defaultUnitVisible ? (
        <div
          className="flex w-[24px] h-6 items-center justify-between py-1 text-sm text-[var(--slate-8)]"
          style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
        >
          {UNIT_OPTIONS.find((opt) => opt.value === defaultUnit)?.label}
        </div>
      ) : null}

      {inputFocused && onTabPress ? (
        <div className="absolute -bottom-6 -left-0.5 z-30">
          <HoverTooltip variant="secondary">
            <div className="flex items-center gap-2">
              <KeyboardShortcut label="Next">tab</KeyboardShortcut>
            </div>
          </HoverTooltip>
        </div>
      ) : null}
    </div>
  );
});
