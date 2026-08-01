import { Geometry } from '@/lib/geometry';
import { FilterComponent } from '../components/FilterComponent';
import { ChamferFilterData } from './chamfer';
import { FilletFilterData } from './fillet';
import { MirrorFilterData } from './mirror';

export { FilletFilter } from './fillet';

export type FilterData = FilletFilterData | ChamferFilterData | MirrorFilterData;

export type Filter = Geometry<FilterComponent>;

export type FilterTemplate = Omit<Geometry<FilterComponent>, 'id'>;
