import { Length } from "@/lib/units/length";
import { FilterComponent } from "../components/FilterComponent";
import { ConstraintEndpoint } from "@/lib/geometry/constraints";
import { Geometry } from '@/lib/geometry';

export type FilletFilterData = {
  type: 'fillet';
  geometryId: Geometry['id'];
  pointA: ConstraintEndpoint;
  pointCenter: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
  offset: Length;
};

export type MirrorFilterData = {
  type: 'mirror';
  geometryId: Geometry['id'];
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export type FilterData =
  | FilletFilterData
  | MirrorFilterData;

export type Filter = Geometry<FilterComponent>;

export type FilterTemplate = Omit<Geometry<FilterComponent>, 'id'>;
