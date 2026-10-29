import type { CategorySummary } from '@/shared/types';
import { formatBytes, formatNumber } from '@/shared/utils/format';

import { StatusPill } from './StatusPill';

export function CategoryList({
  categories,
  onSelect,
  selectedId,
  onGrantPermission
}: {
  categories: CategorySummary[];
  onSelect?: (categoryId: CategorySummary['id']) => void;
  selectedId?: string;
  onGrantPermission?: (categoryId: CategorySummary['id']) => void;
}) {
  return (
    <div className="sd-list">
      {categories.map((category) => (
        <div
          key={category.id}
          className="sd-category"
          onClick={() => onSelect?.(category.id)}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onKeyDown={(event) => {
            if (!onSelect) {
              return;
            }

            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(category.id);
            }
          }}
          style={{
            ...(selectedId === category.id ? { outline: '2px solid rgba(59,130,246,0.5)' } : undefined),
            cursor: onSelect ? 'pointer' : 'default'
          }}
        >
          <div style={{ textAlign: 'left' }}>
            <strong>{category.label}</strong>
            <div className="sd-subtle sd-code">
              {formatNumber(category.itemCount)} items • {formatBytes(category.estimatedSizeBytes)}
            </div>
            {category.warnings[0] ? <div className="sd-subtle" style={{ marginTop: 8 }}>{category.warnings[0]}</div> : null}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <StatusPill value={category.accessState} />
            <StatusPill value={category.permissionState} />
            {category.permissionState === 'required' && onGrantPermission ? (
              <button
                className="sd-button"
                onClick={(event) => {
                  event.stopPropagation();
                  void onGrantPermission(category.id);
                }}
              >
                Grant access
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
