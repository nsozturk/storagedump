import { useState } from 'react';

import type { CategoryDetail, MutationAction } from '@/shared/types';

export function MutationForm({
  detail,
  onSubmit,
  disabled
}: {
  detail: CategoryDetail;
  onSubmit: (action: MutationAction) => Promise<void>;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<'create' | 'update' | 'delete' | 'clear'>('update');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('{}');
  const [storageArea, setStorageArea] = useState<'local' | 'sync'>('local');

  const isWritable = detail.summary.mutationCapabilities.length > 0;

  if (!isWritable) {
    return <div className="sd-banner">This category is read-only in v1.</div>;
  }

  async function handleSubmit() {
    const payload: MutationAction = {
      type: mode,
      key: key || undefined,
      value: value ? parseMaybeJson(value) : undefined,
      target:
        detail.id === 'indexeddb'
          ? {
              dbName: String(detail.metadata?.dbName ?? ''),
              storeName: String(detail.metadata?.storeName ?? '')
            }
          : detail.id === 'extension'
            ? { storageArea }
            : undefined,
      storageArea: detail.id === 'extension' ? storageArea : undefined
    };

    if (mode === 'clear' && !confirm(`Clear all records from ${detail.summary.label}?`)) {
      return;
    }

    if (mode === 'delete' && key && !confirm(`Delete "${key}" from ${detail.summary.label}?`)) {
      return;
    }

    await onSubmit(payload);
  }

  return (
    <div className="sd-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 14 }}>
        <strong>Mutation Console</strong>
        <select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
          {detail.summary.mutationCapabilities.includes('create') ? <option value="create">Create</option> : null}
          {detail.summary.mutationCapabilities.includes('update') ? <option value="update">Update</option> : null}
          {detail.summary.mutationCapabilities.includes('delete') ? <option value="delete">Delete</option> : null}
          {detail.summary.mutationCapabilities.includes('clear') ? <option value="clear">Clear</option> : null}
        </select>
      </div>

      <div className="sd-grid cols-2">
        <label className="sd-field">
          <span>Key</span>
          <input value={key} onChange={(event) => setKey(event.target.value)} disabled={mode === 'clear' || disabled} />
        </label>
        {detail.id === 'extension' ? (
          <label className="sd-field">
            <span>Storage area</span>
            <select value={storageArea} onChange={(event) => setStorageArea(event.target.value as 'local' | 'sync')}>
              <option value="local">local</option>
              <option value="sync">sync</option>
            </select>
          </label>
        ) : null}
      </div>

      {mode === 'create' || mode === 'update' ? (
        <label className="sd-field" style={{ marginTop: 12 }}>
          <span>JSON / string value</span>
          <textarea value={value} onChange={(event) => setValue(event.target.value)} disabled={disabled} />
        </label>
      ) : null}

      <div className="sd-actions" style={{ marginTop: 14 }}>
        <button className="sd-button primary" onClick={() => void handleSubmit()} disabled={disabled}>
          Apply mutation
        </button>
      </div>
    </div>
  );
}

function parseMaybeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
