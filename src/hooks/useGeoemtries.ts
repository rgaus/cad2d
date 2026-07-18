import { useEffect, useState } from 'react';
import {
  FillColorComponent,
  GeometryComponent,
  LinkDimensionsComponent,
  RenderOrderComponent,
} from '@/lib/entity';
import { type Geometry } from '@/lib/entity/geometry';
import { GeometryStore } from '@/lib/entity/GeometryStore';

export const useGeometries = (geometryStore: GeometryStore) => {
  const [geometries, setGeometries] = useState<Array<Geometry>>([]);
  useEffect(() => {
    const refresh = () => {
      setGeometries(
        geometryStore.listWithComponents(
          GeometryComponent,
          FillColorComponent,
          LinkDimensionsComponent,
          RenderOrderComponent,
        ),
      );
    };
    geometryStore.on('geometryAdded', refresh);
    geometryStore.on('geometryUpdated', refresh);
    geometryStore.on('geometryDeleted', refresh);
    return () => {
      geometryStore.off('geometryAdded', refresh);
      geometryStore.off('geometryUpdated', refresh);
      geometryStore.off('geometryDeleted', refresh);
    };
  }, [geometryStore]);
  return geometries;
};
