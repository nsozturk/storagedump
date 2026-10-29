import type { CategoryDetail } from '@/shared/types';
import { formatBytes } from '@/shared/utils/format';

export function DataTable({
  detail,
  onDelete
}: {
  detail: CategoryDetail;
  onDelete?: (key: string) => void;
}) {
  if (detail.entries.length === 0) {
    return <div className="sd-empty">No entries available for this category.</div>;
  }

  return (
    <div className="sd-table-wrap">
      <table className="sd-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Preview</th>
            <th>Size</th>
            <th>Metadata</th>
            {onDelete ? <th>Action</th> : null}
          </tr>
        </thead>
        <tbody>
          {detail.entries.map((entry) => (
            <tr key={entry.id}>
              <td className="sd-code">{entry.key}</td>
              <td className="sd-code">{entry.valuePreview}</td>
              <td>{formatBytes(entry.sizeBytes)}</td>
              <td className="sd-code">{entry.metadata ? JSON.stringify(entry.metadata) : '—'}</td>
              {onDelete ? (
                <td>
                  <button className="sd-button danger" onClick={() => onDelete(entry.key)}>
                    Delete
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
