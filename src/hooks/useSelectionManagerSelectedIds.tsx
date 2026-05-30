import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';

/** Returns a list of all currently selected geometries. */
export const useSelectionManagerSelectedIds = () => {
  const { selectionManager } = useViewportContext();

  const [selectedIds, setSelectedIds] = useState(selectionManager.getSelectedIds());
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  return selectedIds;
};
