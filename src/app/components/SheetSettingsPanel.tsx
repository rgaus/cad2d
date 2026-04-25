"use client";

import { Sheet } from "@/lib/sheet/Sheet";
import { UNITS, type UnitType } from "@/lib/units/length";
import type { Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";

type SheetSettingsPanelProps = {
  sheet: Sheet;
  onWidthChange: (width: Length) => void;
  onHeightChange: (height: Length) => void;
  onDefaultUnitChange: (unit: UnitType) => void;
};

export default function SheetSettingsPanel({ sheet, onWidthChange, onHeightChange, onDefaultUnitChange }: SheetSettingsPanelProps) {
  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Default unit:">
          <select
            value={sheet.defaultUnit}
            onChange={(e) => onDefaultUnitChange(e.target.value as UnitType)}
            className="bg-[#444] text-white text-sm px-2 py-1 rounded border border-[#555] hover:border-[#666] focus:outline-none focus:border-[#888]"
          >
            {UNITS.map(unit => (
              <option key={unit} value={unit}>{unit}</option>
            ))}
          </select>
        </LabeledRow>
        <LabeledRow label="Width:">
          <LengthInput value={sheet.width} onChange={onWidthChange} />
        </LabeledRow>
        <LabeledRow label="Height:">
          <LengthInput value={sheet.height} onChange={onHeightChange} />
        </LabeledRow>
      </div>
    </FloatingPanel>
  );
}
