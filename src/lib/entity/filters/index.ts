import { FilterComponent } from '../components/FilterComponent';
import { Entity } from '../types';
import { ChamferFilterData } from './chamfer';
import { FilletFilterData } from './fillet';
import { MirrorFilterData } from './mirror';
import { PatternFilterData } from './pattern';

export { FilletFilter } from './fillet';

export type FilterData =
  | FilletFilterData
  | ChamferFilterData
  | MirrorFilterData
  | PatternFilterData;

export type Filter = Entity<FilterComponent>;

export type FilterTemplate = Omit<Entity<FilterComponent>, 'id'>;
