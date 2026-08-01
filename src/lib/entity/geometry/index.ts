import { GeometryComponent } from '../components/GeometryComponent';
import { Entity } from '../types';
import { EllipseData } from './ellipse';
import { PolygonData } from './polygon';
import { RectangleData } from './rectangle';

export type GeometryData = PolygonData | RectangleData | EllipseData;

export type Geometry = Entity<GeometryComponent>;

export type GeometryTemplate = Omit<Entity<GeometryComponent>, 'id'>;
