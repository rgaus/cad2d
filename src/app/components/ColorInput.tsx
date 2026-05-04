"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import colorRgba from 'color-rgba';
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export const PRESET_COLORS_BY_LABEL = {
  "gray-3": 0xf0f0f0,
  "blue-3": 0xe6f4fe,
  "grass-3": 0xe9f6e9,
  "amber-3": 0xfff7c2,
  "violet-3": 0xf4f0fe,
  "gray-8": 0x8d8d8d,
  "blue-8": 0x5eb1ef,
  "grass-8": 0x65ba74,
  "amber-8": 0xe2a336,
  "violet-8": 0xaa99ec,
};

type ColorInputProps = {
  value: number | null;
  openDirection?: 'up' | 'down',
  onChange: (color: number | null) => void;
};

function hexToDisplay(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

const ColorInput: React.FunctionComponent<ColorInputProps> = ({ value, onChange }) => {
  const [inputValue, setInputValue] = useState(() =>
    value === null ? "" : "#" + value.toString(16).padStart(6, "0")
  );
  const [isInvalid, setIsInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(value === null ? "" : "#" + value.toString(16).padStart(6, "0"));
  }, [value]);

  const commitValue = useCallback(
    (raw: string) => {
      if (raw.trim() === "" || raw.trim() === "none" || raw.trim() === "null" || raw.trim() === "transparent") {
        setInputValue("");
        setIsInvalid(false);
        onChange(null);
        return;
      }

      let resultRgba = colorRgba(raw.replace(/^0x/, ''));
      if (resultRgba.length === 0) {
        resultRgba = colorRgba(`#${raw}`);
      }

      if (resultRgba.length !== 0) {
        const parsed = ((resultRgba[0] << 16) | (resultRgba[1] << 8) | resultRgba[2]) >>> 0;
        const hex = "#" + parsed.toString(16).padStart(6, "0");
        setInputValue(hex);
        setIsInvalid(false);
        onChange(parsed);
        return;
      }

      setIsInvalid(true);
    },
    [onChange]
  );

  const handleInputBlur = useCallback(() => {
    commitValue(inputValue);
  }, [inputValue, commitValue]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();

      if (e.key === "Enter") {
        commitValue(inputValue);
      }
    },
    [inputValue, commitValue]
  );

  const handlePresetClick = useCallback((color: number) => {
    setInputValue(`#${color.toString(16)}`);
    setIsInvalid(false);
    onChange(color);
  }, [onChange]);

  const handleNoneClick = useCallback(() => {
    setInputValue("");
    setIsInvalid(false);
    onChange(null);
  }, [onChange]);

  const bgColor = value === null ? "#ffffff" : "#" + value.toString(16).padStart(6, "0");
  const textColor = value === null ? "#666666" : hexToDisplay(bgColor);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="w-full h-8 px-2 rounded-[4px] border cursor-text font-bold transition-colors flex items-center gap-2"
          style={{
            backgroundColor: value === null ? "#ffffff" : bgColor,
            borderColor: isInvalid ? "#e74c3c" : "var(--slate-5)",
            color: value === null ? "var(--slate-7)" : textColor,
          }}
        >
          {value === null ? (
            <span className="text-sm" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
              None
            </span>
          ) : (
            <span
              className="text-sm font-mono"
              style={{ fontFamily: "var(--font-roboto-mono), monospace", color: textColor }}
            >
              {inputValue}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-3 min-w-[200px]" align="end">
        <div className="grid grid-cols-5 gap-1.5 mb-3">
          {Object.entries(PRESET_COLORS_BY_LABEL).map(([label, hex]) => (
            <button
              key={label}
              type="button"
              title={`#${hex.toString(16)}`}
              onClick={() => handlePresetClick(hex)}
              className="w-8 h-8 rounded border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
              style={{ backgroundColor: `#${hex.toString(16)}` }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={handleNoneClick}
          className="w-full h-8 rounded border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors flex items-center justify-center mb-3 relative overflow-hidden"
          style={{ backgroundColor: "#ffffff" }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "repeating-linear-gradient(45deg, #ccc 0, #ccc 1px, transparent 0, transparent 50%)",
              backgroundSize: "8px 8px",
            }}
          />
        </button>

        <div className="flex items-center gap-1">
          <span
            className="text-[var(--slate-12)] text-sm"
            style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
          >
            #
          </span>
          <Input
            ref={inputRef}
            type="text"
            value={inputValue.replace(/^#/, "")}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            placeholder="hex, rgb, name..."
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ColorInput;
