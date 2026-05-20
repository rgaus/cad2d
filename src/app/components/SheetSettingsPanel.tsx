"use client";

import { useState, useEffect } from "react";
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
  const [sheetWidth, setSheetWidth] = useState(sheet.width);
  const [sheetHeight, setSheetHeight] = useState(sheet.height);
  const [sheetDefaultUnit, setSheetDefaultUnit] = useState(sheet.defaultUnit);

  useEffect(() => {
    sheet.on('widthChange', setSheetWidth);
    sheet.on('heightChange', setSheetHeight);
    sheet.on('defaultUnitChange', setSheetDefaultUnit);
    return () => {
      sheet.off('widthChange', setSheetWidth);
      sheet.off('heightChange', setSheetHeight);
      sheet.off('defaultUnitChange', setSheetDefaultUnit);
    };
  }, [sheet]);

  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Default unit:">
          <Select value={sheetDefaultUnit} onValueChange={(value) => onDefaultUnitChange(value as UnitType)}>
            <SelectTrigger>
              <SelectValue placeholder="ie: cm" />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map(unit => (
                <SelectItem key={unit} value={unit}>{unit}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledRow>
        <LabeledRow label="Width:">
          <LengthInput value={sheetWidth} onChange={onWidthChange} />
        </LabeledRow>
        <LabeledRow label="Height:">
          <LengthInput value={sheetHeight} onChange={onHeightChange} />
        </LabeledRow>
      </div>
    </FloatingPanel>
  );
}
