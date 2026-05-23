import React from "react";
import { Grid2x2Plus } from "lucide-react";
import { round } from "@/lib/math";
import { BaseAction } from "./BaseAction";

export class ReconstrainAction extends BaseAction {
  type = "reconstrain" as const;
  label = "Recompute constraints";
  get icon(): React.ReactNode {
    return <Grid2x2Plus size={20} />;
  }

  async execute() {
    const start = performance.now();
    this.getGeometryStore().reconstrain(
      this.getSheet().defaultUnit,
      [],
    );
    const end = performance.now();
    console.log('Reconstrain time:', round(end - start, 2), 'ms');
  }
}
