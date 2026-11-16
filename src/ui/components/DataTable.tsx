import { Fragment, useMemo, useState } from 'react';

import type { CategoryDetail, CategoryEntry } from '@/shared/types';
import { formatBytes, formatNumber } from '@/shared/utils/format';

function fullValue(entry: CategoryEntry): string {
  if (entry.value === undefined) {
    return entry.valuePreview;
  }
  return typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2);
}

export function DataTable({
  detail,
  onDelete,
  onLoadAll
}: {
  detail: CategoryDetail;
  onDelete?: (key: string) => void;
  /** Present when the list was cut at the page limit; loads every entry. */
  onLoadAll?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return detail.entries;
    }
    return detail.entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(needle) ||
        entry.valuePreview.toLowerCase().includes(needle) ||
        (entry.metadata ? JSON.stringify(entry.metadata).toLowerCase().includes(needle) : false)
    );
  }, [detail.entries, query]);

  if (detail.entries.length === 0) {
    return <div className="sd-empty">No entries available for this category.</div>;
  }

  const total = Number(detail.metadata?.totalCount ?? detail.summary.itemCount ?? detail.entries.length);
  const columns = onDelete ? 5 : 4;

  return (
    <div>
      <div className="sd-table-tools">
        <input
          className="sd-filter"
          type="search"
          placeholder="Filter by key, value or metadata"
          aria-label="Filter entries"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="sd-subtle sd-table-count">
          {query ? `${formatNumber(visible.length)} of ${formatNumber(detail.entries.length)} match` : `${formatNumber(detail.entries.length)} entries`}
        </span>
      </div>

      {detail.truncated ? (
        <div className="sd-banner sd-truncated">
          <span>
            Showing the first {formatNumber(detail.entries.length)}
            {total > detail.entries.length ? ` of ${formatNumber(total)}` : ''} entries. Exports always include everything.
          </span>
          {onLoadAll ? (
            <button className="sd-button" onClick={onLoadAll}>
              Load all
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="sd-table-wrap">
        <table className="sd-table">
          <thead>
            <tr>
              <th className="sd-col-key">Key</th>
              <th>Preview</th>
              <th className="sd-col-size">Size</th>
              <th className="sd-col-meta">Metadata</th>
              {onDelete ? <th className="sd-col-action">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((entry) => (
              <Fragment key={entry.id}>
                <tr
                  className={`sd-row ${openId === entry.id ? 'is-open' : ''}`}
                  onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
                  title="Click to show the full value"
                >
                  <td className="sd-code sd-cell-clip">{entry.key}</td>
                  <td className="sd-code sd-cell-clip">{entry.valuePreview}</td>
                  <td className="sd-nowrap">{formatBytes(entry.sizeBytes)}</td>
                  <td className="sd-code sd-cell-clip">{entry.metadata ? JSON.stringify(entry.metadata) : '—'}</td>
                  {onDelete ? (
                    <td>
                      <button
                        className="sd-button danger"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDelete(entry.key);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
                {openId === entry.id ? (
                  <tr className="sd-row-detail">
                    <td colSpan={columns}>
                      <div className="sd-detail-head">
                        <strong className="sd-code">{entry.key}</strong>
                        <button
                          className="sd-button"
                          onClick={() => {
                            void navigator.clipboard.writeText(fullValue(entry)).then(() => {
                              setCopiedId(entry.id);
                              window.setTimeout(() => setCopiedId(null), 1500);
                            });
                          }}
                        >
                          {copiedId === entry.id ? 'Copied' : 'Copy value'}
                        </button>
                      </div>
                      <pre className="sd-code sd-detail-value">{fullValue(entry)}</pre>
                      {entry.metadata ? <pre className="sd-code sd-detail-meta">{JSON.stringify(entry.metadata, null, 2)}</pre> : null}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 ? <div className="sd-empty">Nothing matches “{query}”.</div> : null}
    </div>
  );
}
