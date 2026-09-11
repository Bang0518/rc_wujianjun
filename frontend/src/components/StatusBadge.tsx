import type { NotificationStatus } from '@notify/common';

const COLORS: Record<NotificationStatus, string> = {
  pending: '#6b7280', // 灰
  delivering: '#2563eb', // 蓝
  succeeded: '#16a34a', // 绿
  failed: '#dc2626', // 红
  dead_letter: '#b91c1c', // 深红
};

const LABELS: Record<NotificationStatus, string> = {
  pending: '待投递',
  delivering: '投递中',
  succeeded: '成功',
  failed: '永久失败',
  dead_letter: '死信',
};

export function StatusBadge({ status }: { status: NotificationStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 12,
        color: '#fff',
        background: COLORS[status],
        whiteSpace: 'nowrap',
      }}
    >
      {LABELS[status]}
    </span>
  );
}
