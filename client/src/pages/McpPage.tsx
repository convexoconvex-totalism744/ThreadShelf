import { useUIStore } from '../store';
import { Topbar } from '../components/Topbar';
import { McpView } from '../components/McpView';

export function McpPage() {
  const activeColl = useUIStore((s) => s.activeColl);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  return (
    <>
      <Topbar view="mcp" activeColl={activeColl} onMenu={() => setSidebarOpen(true)} />
      <div className="main-scroll">
        <McpView />
      </div>
    </>
  );
}
