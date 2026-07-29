import { useSearch, useRouter, useNavigate } from '@tanstack/react-router';
import { useUIStore } from '../store';
import { ThreadReader } from '../components/ThreadReader';
import { moreLikeThisQuery } from '../utils';

export function ThreadPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const search = useSearch({ from: '/thread' });
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const activeColl = useUIStore((s) => s.activeColl);

  const collection = search.collection ?? activeColl;

  return (
    <ThreadReader
      sourceFile={search.sourceFile}
      collection={collection}
      conversationKey={search.conversationKey}
      title={search.title}
      matchIdx={search.matchIdx}
      provider={search.provider}
      model={search.model}
      onBack={() => router.history.back()}
      onMenu={() => setSidebarOpen(true)}
      query={search.q ?? ''}
      onSimilar={(text) => {
        const q = moreLikeThisQuery(text);
        if (!q) return;
        void navigate({
          to: '/search/$collection',
          params: { collection: collection === '__all__' ? 'all' : collection },
          search: { q },
        });
      }}
    />
  );
}
