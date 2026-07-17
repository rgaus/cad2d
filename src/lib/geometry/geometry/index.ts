import { Entity } from '@/lib/geometry';
import { GeometryComponent } from '@/lib/geometry/components/GeometryComponent';
import { PolygonData } from './polygon';

export type GeometryData = PolygonData | { type: 'x', foo: 'bar' };

export type Geometry = Entity<GeometryComponent>;

export type GeometryTemplate = Omit<Entity<GeometryComponent>, 'id'>;
