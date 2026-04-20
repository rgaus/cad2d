"use client";

import { useState, useCallback } from "react";
import { Lengths, type Length, InchesLength, FeetLength, MillimetersLength, CentimetersLength, MetersLength } from "@/lib/units/length";

type UnitOption = "in" | "ft" | "mm" | "cm" | "m";

const UNIT_OPTIONS: Array<{ value: UnitOption; label: string }> = [
  { value: "in", label: "in" },
  { value: "ft", label: "ft" },
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
  { value: "m", label: "m" },
];

function getUnitFromLength(length: Length): UnitOption {
  if (length.type === InchesLength.prototype.type) return "in";
  if (length.type === FeetLength.prototype.type) return "ft";
  if (length.type === MillimetersLength.prototype.type) return "mm";
  if (length.type === CentimetersLength.prototype.type) return "cm";
  if (length.type === MetersLength.prototype.type) return "m";
  return "cm";
}

function createLengthFromMagnitudeAndUnit(magnitude: number, unit: UnitOption): Length {
  switch (unit) {
    case "in": return Lengths.inches(magnitude);
    case "ft": return Lengths.feet(magnitude);
    case "mm": return Lengths.mm(magnitude);
    case "cm": return Lengths.centimeters(magnitude);
    case "m": return Lengths.meters(magnitude);
  }
}

function parseSuffix(text: string): { magnitude: number; unit: UnitOption | null } {
  const trimmed = text.trim();
  if (!trimmed) return { magnitude: 0, unit: null };

  const match = trimmed.match(/^([\d.]+)\s*([a-zA-Z'"]*)$/);
  if (!match) return { magnitude: parseFloat(text) || 0, unit: null };

  const magnitude = parseFloat(match[1]);
  const suffix = match[2].toLowerCase();

  if (suffix === "" || suffix === "i" || suffix === "in" || suffix === "inch" || suffix === "inches" || suffix === '"') {
    return { magnitude, unit: "in" };
  }
  if (suffix === "f" || suffix === "ft" || suffix === "foot" || suffix === "feet" || suffix === "'") {
    return { magnitude, unit: "ft" };
  }
  if (suffix === "mi" || suffix === "mm" || suffix === "millimeter" || suffix === "millimeters") {
    return { magnitude, unit: "mm" };
  }
  if (suffix === "c" || suffix === "cm" || suffix === "centimeter" || suffix === "centimeters") {
    return { magnitude, unit: "cm" };
  }
  if (suffix === "me" || suffix === "met" || suffix === "mete" || suffix === "meter" || suffix === "meters") {
    return { magnitude, unit: "m" };
  }

  return { magnitude, unit: null };
}

type LengthInputProps = {
  value: Length;
  onChange: (length: Length) => void;
};

export default function LengthInput({ value, onChange }: LengthInputProps) {
  const [inputValue, setInputValue] = useState(() => value.magnitude.toString());
  const [selectedUnit, setSelectedUnit] = useState<UnitOption>(() => getUnitFromLength(value));

  const handleUnitChange = useCallback((newUnit: UnitOption) => {
    setSelectedUnit(newUnit);
    const parsed = parseSuffix(inputValue);
    const magnitude = parsed.magnitude || 0;
    onChange(createLengthFromMagnitudeAndUnit(magnitude, newUnit));
  }, [inputValue, onChange]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newInput = e.target.value;
    setInputValue(newInput);

    const parsed = parseSuffix(newInput);
    if (parsed.unit !== null) {
      setSelectedUnit(parsed.unit);
    }
  }, []);

  const handleBlur = useCallback(() => {
    const parsed = parseSuffix(inputValue);
    const cleanMagnitude = parsed.magnitude.toString();
    setInputValue(cleanMagnitude);
    onChange(createLengthFromMagnitudeAndUnit(parsed.magnitude, selectedUnit));
  }, [inputValue, selectedUnit, onChange]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        className="flex-1 px-2 py-1 bg-[#333] text-white border border-[#555] rounded text-sm font-mono outline-none focus:border-[#888]"
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      />
      <select
        value={selectedUnit}
        onChange={(e) => handleUnitChange(e.target.value as UnitOption)}
        className="w-16 px-2 py-1 bg-[#333] text-white border border-[#555] rounded text-sm font-mono outline-none cursor-pointer focus:border-[#888]"
        style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
      >
        {UNIT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
