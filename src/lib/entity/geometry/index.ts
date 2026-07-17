import { GeometryComponent } from '../components/GeometryComponent';
import { Entity } from '../types';
import { PolygonData } from './polygon';
import { RectangleData } from './rectangle';
import { EllipseData } from './ellipse';

export type GeometryData = PolygonData | RectangleData | EllipseData;

export type Geometry = Entity<GeometryComponent>;

export type GeometryTemplate = Omit<Entity<GeometryComponent>, 'id'>;
