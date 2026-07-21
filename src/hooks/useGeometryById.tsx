import { useEffect, useState } from 'react';
import { GeometryStore } from '@/lib/entity/GeometryStore';
import { Entity } from '@/lib/entity/types';

export const useGeometryById = (
  geometryStore: GeometryStore,
  geometryId: Entity['id'],
): Entity | null => {
  const [geometry, setGeometry] = useState<Entity | null>(() => geometryStore.getById(geometryId));
  useEffect(() => setGeometry(geometryStore.getById(geometryId)), [geometryId]);

  useEffect(() => {
    const handleUpsert = (geometry: Entity) => {
      if (geometry.id === geometryId) {
        setGeometry(geometry);
      }
    };
    const handleDelete = (id: Entity['id']) => {
      if (id === geometryId) {
        setGeometry(null);
      }
    };
    geometryStore.on('geometryAdded', handleUpsert);
    geometryStore.on('geometryUpdated', handleUpsert);
    geometryStore.on('geometryDeleted', handleDelete);
    return () => {
      geometryStore.off('geometryAdded', handleUpsert);
      geometryStore.off('geometryUpdated', handleUpsert);
      geometryStore.off('geometryDeleted', handleDelete);
    };
  }, [geometryStore]);

  return geometry;
};

export const useGeometriesById = (
  geometryStore: GeometryStore,
  ids: Array<Entity['id']>,
): Map<Entity['id'], Entity> => {
  const [geometryMap, setGeometryMap] = useState<Map<Entity['id'], Entity>>(() => new Map());
  useEffect(() => {
    setGeometryMap(
      new Map(
        ids.flatMap((id) => {
          const geom = geometryStore.getById(id);
          if (geom) {
            return [[id, geom]];
          } else {
            return [];
          }
        }),
      ),
    );
  }, [ids]);

  useEffect(() => {
    const handleUpsert = (geometry: Entity) => {
      if (ids.includes(geometry.id)) {
        setGeometryMap((old) => {
          const newMap = new Map(old);
          newMap.set(geometry.id, geometry);
          return newMap;
        });
      }
    };
    const handleDelete = (id: Entity['id']) => {
      if (ids.includes(id)) {
        setGeometryMap((old) => {
          const newMap = new Map(old);
          newMap.delete(id);
          return newMap;
        });
      }
    };
    geometryStore.on('geometryAdded', handleUpsert);
    geometryStore.on('geometryUpdated', handleUpsert);
    geometryStore.on('geometryDeleted', handleDelete);
    return () => {
      geometryStore.off('geometryAdded', handleUpsert);
      geometryStore.off('geometryUpdated', handleUpsert);
      geometryStore.off('geometryDeleted', handleDelete);
    };
  }, [geometryStore, ids]);

  return geometryMap;
};
