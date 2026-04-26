"use client";

import { useState, useCallback, useEffect, useRef } from "react";

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
  onChange: (color: number | null) => void;
};

function hexToDisplay(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

function parseColorString(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  
  if (trimmed === "" || trimmed === "none" || trimmed === "null" || trimmed === "transparent") {
    return null;
  }
  
  if (trimmed.startsWith("#")) {
    const hex = trimmed.slice(1);
    if (/^[0-9a-f]{3}$/.test(hex)) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return ((r << 16) | (g << 8) | b) >>> 0;
    }
    if (/^[0-9a-f]{6}$/.test(hex)) {
      return parseInt(hex, 16) >>> 0;
    }
    return null;
  }
  
  const rgbMatch = trimmed.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
      return ((r << 16) | (g << 8) | b) >>> 0;
    }
    return null;
  }
  
  const namedColors: Record<string, number> = {
    black: 0x000000,
    white: 0xffffff,
    red: 0xff0000,
    green: 0x00ff00,
    blue: 0x0000ff,
    yellow: 0xffff00,
    cyan: 0x00ffff,
    magenta: 0xff00ff,
    gray: 0x808080,
    grey: 0x808080,
    orange: 0xffa500,
    purple: 0x800080,
    pink: 0xffc0cb,
    brown: 0xa52a2a,
    navy: 0x000080,
    teal: 0x008080,
    olive: 0x808000,
    maroon: 0x800000,
    lime: 0x00ff00,
    aqua: 0x00ffff,
    silver: 0xc0c0c0,
  };
  
  if (namedColors[trimmed] !== undefined) {
    return namedColors[trimmed];
  }
  
  return null;
}

export default function ColorInput({ value, onChange }: ColorInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    value === null ? "" : "#" + value.toString(16).padStart(6, "0")
  );
  const [isInvalid, setIsInvalid] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(value === null ? "" : "#" + value.toString(16).padStart(6, "0"));
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const commitValue = useCallback(
    (raw: string) => {
      const parsed = parseColorString(raw);
      if (parsed !== null) {
        const hex = "#" + parsed.toString(16).padStart(6, "0");
        setInputValue(hex);
        setIsInvalid(false);
        onChange(parsed);
      } else if (raw.trim() === "" || raw.trim() === "none" || raw.trim() === "null" || raw.trim() === "transparent") {
        setInputValue("");
        setIsInvalid(false);
        onChange(null);
      } else {
        setIsInvalid(true);
      }
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
      if (e.key === "Enter") {
        commitValue(inputValue);
        setIsOpen(false);
      }
    },
    [inputValue, commitValue]
  );

  const handlePresetClick = useCallback(
    (hex: string) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const color = ((r << 16) | (g << 8) | b) >>> 0;
      setInputValue(hex);
      setIsInvalid(false);
      onChange(color);
      setIsOpen(false);
    },
    [onChange]
  );

  const handleNoneClick = useCallback(() => {
    setInputValue("");
    setIsInvalid(false);
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  const bgColor = value === null ? "#ffffff" : "#" + value.toString(16).padStart(6, "0");
  const textColor = value === null ? "#666666" : hexToDisplay(bgColor);

  return (
    <div className="relative">
      <div ref={triggerRef}>
        <button
          type="button"
          onClick={handleTriggerClick}
          className="w-full h-8 px-2 rounded border transition-colors flex items-center gap-2"
          style={{
            backgroundColor: value === null ? "#ffffff" : bgColor,
            borderColor: isInvalid ? "#e74c3c" : "#555",
            color: value === null ? "#666" : textColor,
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
              {inputValue.toUpperCase()}
            </span>
          )}
        </button>
      </div>

      {isOpen && (
        <div
          ref={popupRef}
          className="absolute top-full left-0 mt-1 z-50 bg-[#333] border border-[#555] rounded p-3 min-w-[200px]"
        >
          <div className="grid grid-cols-5 gap-1.5 mb-3">
            {Object.entries(PRESET_COLORS_BY_LABEL).map(([label, color]) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => handlePresetClick("#" + color.toString(16).padStart(6, "0"))}
                className="w-8 h-8 rounded border border-[#555] hover:border-[#888] transition-colors"
                style={{ backgroundColor: "#" + color.toString(16).padStart(6, "0") }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={handleNoneClick}
            className="w-full h-8 rounded border border-[#555] hover:border-[#888] transition-colors flex items-center justify-center mb-3 relative overflow-hidden"
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
              className="text-white text-sm"
              style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
            >
              #
            </span>
            <input
              type="text"
              value={inputValue.replace(/^#/, "")}
              onChange={(e) => setInputValue("#" + e.target.value)}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              placeholder="hex, rgb, name..."
              className="grow shrink w-0 min-w-[64px] px-2 py-1 bg-[#222] text-white border border-[#555] rounded text-sm font-mono outline-none focus:border-[#888]"
              style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
            />
          </div>
        </div>
      )}
    </div>
  );
}