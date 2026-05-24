import { Length } from "@/lib/units/length";
import { HistoryManager } from "@/lib/history/HistoryManager";
import { ID_PREFIXES } from "@/lib/tools/GeometryStore";
import { Id } from "../id";
import { ConstraintEndpoint } from "../types";

/** The default distance (in px) that the linear offset label is offset from the connector line
 * between pointA and pointB. */
export const LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX = -12;

export type LinearConstraint = {
  id: Id;
  type: 'linear';
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  constrainedLength: Length;

  /** Offset in pixels of the line connecting the two points together. This is relative to the line
   * connecting pointA / pointB together - negative goes on one side, positive the other. */
  connectorLineOffsetPx: number;
};

export namespace LinearConstraint {
  export function create(
    pointA: ConstraintEndpoint,
    pointB: ConstraintEndpoint,
    length: Length,
    connectorLineOffsetPx?: number,
  ): LinearConstraint {
    return {
      id: HistoryManager.generateId(ID_PREFIXES.constraint),
      type: 'linear',
      pointA,
      pointB,
      constrainedLength: length,
      connectorLineOffsetPx: connectorLineOffsetPx ?? LINEAR_CONSTRAINT_DEFAULT_CONNECTOR_LINE_OFFSET_PX,
    };
  }
}
