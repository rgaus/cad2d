"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import colorRgba from 'color-rgba';
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PRESET_COLORS_BY_LABEL } from "@/lib/tools/GeometryStore";

export const PRESET_COLOR_GRID: Array<Array<keyof typeof PRESET_COLORS_BY_LABEL>> = [
  ["slate-light", "slate-mid", "slate-dark"],
  ["red-light", "red-mid", "red-dark"],
  ["purple-light", "purple-mid", "purple-dark"],
  ["blue-light", "blue-mid", "blue-dark"],
  ["green-light", "green-mid", "green-dark"],
  ["orange-light", "orange-mid", "orange-dark"],
  ["yellow-light", "yellow-mid", "yellow-dark"],
];

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

const ColorInput: React.FunctionComponent<ColorInputProps> = ({ value, openDirection = 'down', onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    value === null ? "" : "#" + value.toString(16).padStart(6, "0")
  );
  const [isInvalid, setIsInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(value === null ? "" : "#" + value.toString(16).padStart(6, "0"));
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  }, [isOpen]);

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

  const handleTriggerClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleInputBlur = useCallback(() => {
    commitValue(inputValue);
  }, [inputValue, commitValue]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Enter':
          commitValue(inputValue);
          setIsOpen(false);
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [inputValue, commitValue]
  );

  const handlePresetClick = useCallback((color: number) => {
    setInputValue(`#${color.toString(16)}`);
    setIsInvalid(false);
    onChange(color);
    setIsOpen(false);
  }, [onChange]);

  const handleNoneClick = useCallback(() => {
    setInputValue("");
    setIsInvalid(false);
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  const bgColor = value === null ? "#ffffff" : "#" + value.toString(16).padStart(6, "0");
  const textColor = value === null ? "#666666" : hexToDisplay(bgColor);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Button
        type="button"
        asChild
        onClick={handleTriggerClick}
        className={cn("w-full h-8 px-1 rounded-[4px] bg-[var(--slate-3)] hover:bg-[var(--slate-4)] border border-[var(--slate-5)] cursor-text font-bold transition-colors justify-start gap-2", {
          "border-[var(--slate-8)] hover:bg-[var(--slate-3)]": isOpen,
          "border-[#e74c3c]": isInvalid,
        })}
        style={{ color: value === null ? "var(--slate-7)" : textColor }}
      >
        <PopoverTrigger>
          {value === null ? (
            <span className="text-sm" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
              None
            </span>
          ) : (
            <span
              className="text-sm font-mono px-1 py-0.5 rounded-md"
              style={{
                fontFamily: "var(--font-roboto-mono), monospace",
                color: textColor,
                backgroundColor: value === null ? "#ffffff" : bgColor,
              }}
            >
              {inputValue}
            </span>
          )}
        </PopoverTrigger>
      </Button>
      <PopoverContent
        className="p-1"
        align="end"
        side={openDirection === "up" ? "bottom" : "top"}

        // Keep these events from propagating and effecting the viewport state at all
        onKeyDown={e => e.stopPropagation()} // (For color hex input box)
      >
        <div className="flex gap-1.5 mb-3">
          {PRESET_COLOR_GRID.map((row, colIndex) => {
            return (
              <div key={colIndex} className="flex flex-col gap-1.5">
                {row.map((label, rowIndex) => {
                  const hex = PRESET_COLORS_BY_LABEL[label];
                  return (
                    <button
                      key={label}
                      type="button"
                      title={`#${hex.toString(16)}`}
                      onClick={() => handlePresetClick(hex)}
                      className="w-8 h-8 rounded border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors"
                      style={{ backgroundColor: `#${hex.toString(16)}`, gridColumnStart: colIndex+1, gridRowStart: rowIndex+1 }}
                    />
                  );
                })}
              </div>
            );
          })}
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
