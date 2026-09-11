import { NOTIFICATION_STATUSES, type NotificationStatus, type StatsResponse } from '@notify/common';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  stats: StatsResponse | null;
  active: NotificationStatus | null;
  onSelect: (status: NotificationStatus | null) => void;
}

/** 顶部各状态计数，点击作为列表过滤器（再次点击取消过滤）。 */
export function StatsBar({ stats, active, onSelect }: Props) {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <button
        onClick={() => onSelect(null)}
        style={{
          border: active === null ? '2px solid #111' : '1px solid #ddd',
          background: '#fff',
          borderRadius: 8,
          padding: '6px 12px',
          cursor: 'pointer',
        }}
      >
        全部
      </button>
      {NOTIFICATION_STATUSES.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(active === s ? null : s)}
          style={{
            border: active === s ? '2px solid #111' : '1px solid #ddd',
            background: '#fff',
            borderRadius: 8,
            padding: '6px 12px',
            cursor: 'pointer',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <StatusBadge status={s} />
          <strong>{stats ? stats[s] : '–'}</strong>
        </button>
      ))}
    </div>
  );
}
