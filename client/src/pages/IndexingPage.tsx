import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useUIStore } from '../store';
import { useCollectionsQuery } from '../queries';
import { Topbar } from '../components/Topbar';
import { IndexingView } from '../components/IndexingView';

export function IndexingPage() {
  const queryClient = useQueryClient();
  const activeColl = useUIStore((s) => s.activeColl);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const { data } = useCollectionsQuery();
  const collections = data?.collections ?? ['all', 'chunks'];

  const onRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['collections'] });
    await queryClient.invalidateQueries({ queryKey: ['files'] });
    await queryClient.invalidateQueries({ queryKey: ['search'] });
    await queryClient.invalidateQueries({ queryKey: ['thread'] });
  }, [queryClient]);

  return (
    <>
      <Topbar view="indexing" activeColl={activeColl} onMenu={() => setSidebarOpen(true)} />
      <div className="main-scroll">
        <IndexingView collections={collections} onRefresh={onRefresh} />
      </div>
    </>
  );
}
