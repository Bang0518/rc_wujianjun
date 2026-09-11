import type { NotificationRecord } from '@notify/common';
import { NotificationRow } from './NotificationRow.js';

interface Props {
  items: NotificationRecord[];
  total: number;
  onSelect: (rec: NotificationRecord) => void;
}

export function NotificationList({ items, total, onSelect }: Props) {
  if (items.length === 0) {
    return <p style={{ color: '#6b7280' }}>暂无记录。</p>;
  }
  return (
    <div>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
        共 {total} 条，显示 {items.length} 条
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd', fontSize: 13 }}>
            <th style={{ padding: 8 }}>ID</th>
            <th style={{ padding: 8 }}>状态</th>
            <th style={{ padding: 8 }}>方法</th>
            <th style={{ padding: 8 }}>目标</th>
            <th style={{ padding: 8, textAlign: 'center' }}>尝试</th>
            <th style={{ padding: 8 }}>最近错误</th>
            <th style={{ padding: 8 }}>更新时间</th>
          </tr>
        </thead>
        <tbody>
          {items.map((rec) => (
            <NotificationRow key={rec.id} rec={rec} onClick={() => onSelect(rec)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
