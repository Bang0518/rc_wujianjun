import { useMemo, useState } from 'react';
import type { NotificationRecord, NotificationStatus } from '@notify/common';
import { getStats, listNotifications } from './api.js';
import { usePolling } from './hooks/usePolling.js';
import { StatsBar } from './components/StatsBar.js';
import { NotificationForm } from './components/NotificationForm.js';
import { NotificationList } from './components/NotificationList.js';
import { NotificationDetail } from './components/NotificationDetail.js';

export function App() {
  const [statusFilter, setStatusFilter] = useState<NotificationStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0); // 手动触发刷新

  const stats = usePolling(getStats, 3000, [nonce]);
  const list = usePolling(
    () => listNotifications({ status: statusFilter ?? undefined, limit: 100 }),
    2500,
    [statusFilter, nonce],
  );

  const refreshAll = () => setNonce((n) => n + 1);

  const items = useMemo<NotificationRecord[]>(() => list.data?.items ?? [], [list.data]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 4 }}>通知投递面板</h1>
      <p style={{ color: '#6b7280', marginTop: 0 }}>出向 Webhook 网关 · 可观测视图</p>

      <section style={{ marginBottom: 24 }}>
        <StatsBar stats={stats.data} active={statusFilter} onSelect={setStatusFilter} />
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, alignItems: 'start' }}>
        <section style={card}>
          <h2 style={h2}>提交通知</h2>
          <NotificationForm onSubmitted={refreshAll} />
        </section>

        <section style={card}>
          <h2 style={h2}>投递记录</h2>
          {list.error && <p style={{ color: '#dc2626' }}>加载失败：{list.error}</p>}
          <NotificationList
            items={items}
            total={list.data?.total ?? 0}
            onSelect={(rec) => setSelectedId(rec.id)}
          />
        </section>
      </div>

      {selectedId && (
        <NotificationDetail
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={refreshAll}
        />
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 20,
  background: '#fff',
};

const h2: React.CSSProperties = { marginTop: 0, fontSize: 18 };
