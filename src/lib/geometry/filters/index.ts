import { Geometry } from '@/lib/geometry';
import { ConstraintEndpoint } from '@/lib/geometry/constraints';
import { FilterComponent } from '../components/FilterComponent';
import { ChamferFilterData } from './chamfer';
import { FilletFilterData } from './fillet';

export type MirrorFilterData = {
  type: 'mirror';
  geometryId: Geometry['id'];
  pointA: ConstraintEndpoint;
  pointB: ConstraintEndpoint;
};

export { FilletFilter } from './fillet';

export type FilterData = FilletFilterData | ChamferFilterData | MirrorFilterData;

export type Filter = Geometry<FilterComponent>;

export type FilterTemplate = Omit<Geometry<FilterComponent>, 'id'>;
