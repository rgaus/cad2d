"use client";

import { Sheet } from "@/lib/sheet/Sheet";
import { UNITS, type UnitType } from "@/lib/units/length";
import type { Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";
import { Select, SelectValue, SelectTrigger, SelectContent, SelectItem } from "@/components/ui/select";

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
          <Select value={sheet.defaultUnit} onValueChange={(value) => onDefaultUnitChange(value as UnitType)}>
            <SelectTrigger />
            <SelectContent>
              {UNITS.map(unit => (
                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
