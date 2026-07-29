import { useCallback } from 'react';
import type { CollectionStats } from '../types';
import { Icons } from '../icons';
import { collLabel } from '../utils';
import { confirmDialog, toast } from '../toast';
import { useFilesQuery, useClearCollectionMutation, useDeleteCollectionMutation } from '../queries';

interface DangerRowProps {
  readonly title: string;
  readonly desc: string;
  readonly btn: string;
  readonly onClick: () => void;
}

function DangerRow({ title, desc, btn, onClick }: DangerRowProps) {
  return (
    <div className="danger-row">
      <div>
        <div className="title">{title}</div>
        <div className="desc">{desc}</div>
      </div>
      <button className="btn danger" onClick={onClick}>
        {Icons.trash} {btn}
      </button>
    </div>
  );
}

interface SettingsViewProps {
  readonly activeColl: string;
  readonly stats: Readonly<Record<string, CollectionStats>>;
  readonly onRefresh: () => Promise<void>;
  readonly onDeleted: () => void;
}

export function SettingsView({ activeColl, stats, onRefresh, onDeleted }: SettingsViewProps) {
  const isAll = activeColl === 'all' || activeColl === '__all__';
  const { data: filesData } = useFilesQuery(activeColl, !isAll);
  const files = filesData ? [...new Set(filesData.files.map((f) => f.sourceFile))] : null;

  const clearMutation = useClearCollectionMutation();
  const deleteMutation = useDeleteCollectionMutation();

  const doClear = useCallback(async () => {
    if (activeColl === 'threadshelf_conversations') {
      toast.error('ThreadShelf conversations are managed from the Chat page.');
      return;
    }
    const ok = await confirmDialog({
      title: `Clear indexed data for "${collLabel(activeColl)}"?`,
      message: 'All vectors are dropped, but the collection itself is kept.',
      confirmLabel: 'Clear data',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearMutation.mutateAsync(activeColl);
      void onRefresh();
      toast.success(`Cleared "${collLabel(activeColl)}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [activeColl, onRefresh, clearMutation]);

  const doDelete = useCallback(async () => {
    if (activeColl === 'chunks' || activeColl === 'threadshelf_conversations') {
      toast.error('Cannot delete the default collection.');
      return;
    }
    const ok = await confirmDialog({
      title: `Delete collection "${collLabel(activeColl)}"?`,
      message:
        'The index and copies previously uploaded through ThreadShelf are deleted. Files in the original folder you selected remain untouched.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(activeColl);
      await onRefresh();
      toast.success(`Deleted "${collLabel(activeColl)}".`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [activeColl, onRefresh, onDeleted, deleteMutation]);

  if (isAll) {
    return (
      <div className="view">
        <div className="section-h">
          <h2>Collection settings</h2>
          <span className="desc">Pick a collection from the sidebar to manage it.</span>
        </div>
        <div className="banner info">
          <span className="ico">{Icons.info}</span>
          <div className="grow">
            Destructive actions are disabled while <b>All collections</b> is selected.
          </div>
        </div>
      </div>
    );
  }

  const st = stats[activeColl];
  const roles = st?.roles ?? { user: 0, thinking: 0, ai: 0 };
  const totalRoles = roles.user + roles.thinking + roles.ai;

  return (
    <div className="view">
      <div className="section-h">
        <h2>
          <span className="mono" style={{ fontWeight: 500 }}>
            {collLabel(activeColl)}
          </span>
        </h2>
        <span className="desc">Local LanceDB table</span>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="stat-grid">
          <div className="stat">
            <span className="k">files</span>
            <span className="v">{(st?.files ?? 0).toLocaleString()}</span>
            <span className="d">source exports</span>
          </div>
          <div className="stat">
            <span className="k">chunks</span>
            <span className="v">{(st?.chunks ?? 0).toLocaleString()}</span>
            <span className="d">indexed vectors</span>
          </div>
          <div className="stat">
            <span className="k">user</span>
            <span className="v">{roles.user.toLocaleString()}</span>
            <span className="d">user turns</span>
          </div>
          <div className="stat">
            <span className="k">response</span>
            <span className="v">{roles.ai.toLocaleString()}</span>
            <span className="d">ai turns</span>
          </div>
        </div>

        {totalRoles > 0 && (
          <div className="role-dist">
            <div className="role-bar">
              <i className="user" style={{ flex: roles.user }} />
              <i className="thinking" style={{ flex: roles.thinking }} />
              <i className="ai" style={{ flex: roles.ai }} />
            </div>
            <div className="role-legend">
              <span>
                <i className="user" />
                User {roles.user}
              </span>
              <span>
                <i className="thinking" />
                Thinking {roles.thinking}
              </span>
              <span>
                <i className="ai" />
                Response {roles.ai}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Indexed files</h3>
          <span className="sub">{st?.files ?? 0} files</span>
        </div>
        <div className="file-list">
          {files === null && <div className="file-list-empty">Loading…</div>}
          {files && files.length === 0 && <div className="file-list-empty">No indexed files.</div>}
          {files?.map((f, i) => {
            const short = String(f).replace(/\\/g, '/').split('/').pop();
            return (
              <div key={i} className="file-row">
                <i />
                <span className="name" title={String(f)}>
                  {short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Danger zone</h3>
          <span className="sub">destructive, irreversible</span>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeColl === 'threadshelf_conversations' ? (
            <p className="muted">
              This protected collection is maintained automatically from chats created or continued
              in ThreadShelf.
            </p>
          ) : (
            <>
              <DangerRow
                title="Clear indexed data"
                desc="Drop all vectors but keep the collection itself."
                btn="Clear data"
                onClick={doClear}
              />
              <DangerRow
                title="Delete collection"
                desc="Delete the index and ThreadShelf upload copies. Files in your original folder stay untouched."
                btn="Delete"
                onClick={doDelete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
