import type { NotificationRecord } from '@notify/common';
import { StatusBadge } from './StatusBadge.js';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function NotificationRow({
  rec,
  onClick,
}: {
  rec: NotificationRecord;
  onClick: () => void;
}) {
  return (
    <tr onClick={onClick} style={{ cursor: 'pointer', borderBottom: '1px solid #eee' }}>
      <td style={{ padding: 8, fontFamily: 'monospace', fontSize: 12 }}>
        {rec.id.slice(0, 8)}…
      </td>
      <td style={{ padding: 8 }}>
        <StatusBadge status={rec.status} />
      </td>
      <td style={{ padding: 8, fontSize: 13 }}>{rec.method}</td>
      <td
        style={{
          padding: 8,
          fontSize: 13,
          maxWidth: 320,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={rec.url}
      >
        {rec.url}
      </td>
      <td style={{ padding: 8, textAlign: 'center' }}>
        {rec.attempts}/{rec.maxAttempts}
      </td>
      <td
        style={{
          padding: 8,
          fontSize: 12,
          color: '#dc2626',
          maxWidth: 240,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={rec.lastError ?? ''}
      >
        {rec.lastError ?? ''}
      </td>
      <td style={{ padding: 8, fontSize: 12, color: '#6b7280' }}>{fmtTime(rec.updatedAt)}</td>
    </tr>
  );
}
