import { useEffect, useState } from 'react';
import { GeometryComponent, RenderOrderComponent } from '@/lib/entity';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { type Geometry } from '@/lib/entity/geometry';

export const useGeometries = (geometryStore: GeometryStore) => {
  const [geometries, setGeometries] = useState<Array<Geometry>>([]);
  useEffect(() => {
    const refresh = () => {
      setGeometries(geometryStore.listWithComponents(GeometryComponent, RenderOrderComponent));
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
