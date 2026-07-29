import { useState, useCallback } from 'react';
import { useCreateCollectionMutation } from '../queries';
import { toast } from '../toast';

interface NewCollectionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (name: string) => void;
}

export function NewCollectionModal({ open, onClose, onCreated }: NewCollectionModalProps) {
  const [name, setName] = useState('');
  const mutation = useCreateCollectionMutation();

  const doCreate = useCallback(async () => {
    if (!name) return;
    try {
      const d = await mutation.mutateAsync(name);
      setName('');
      onClose();
      onCreated(d.collection ?? name);
      toast.success(`Created collection "${d.collection ?? name}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unknown error');
    }
  }, [name, onClose, onCreated, mutation]);

  if (!open) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>New collection</h3>
          <p>
            Collections are local LanceDB tables. Use lowercase, alphanumeric, hyphens, underscores.
          </p>
        </div>
        <div className="modal-body">
          <label>Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_-]/g, '').toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && name && void doCreate()}
            placeholder="my-archive"
          />
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void doCreate()} disabled={!name}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
