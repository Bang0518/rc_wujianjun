import { useEffect, useState } from 'react';
import type { NotificationRecord } from '@notify/common';
import { getNotification, retryNotification } from '../api.js';
import { StatusBadge } from './StatusBadge.js';

function fmtTime(ms: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

/** 详情抽屉：全字段 + 时间线 + 手动重试。 */
export function NotificationDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [rec, setRec] = useState<NotificationRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setRec(await getNotification(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function doRetry() {
    setBusy(true);
    try {
      await retryNotification(id);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canRetry = rec && (rec.status === 'failed' || rec.status === 'dead_letter');

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 'min(560px, 92vw)',
        height: '100vh',
        background: '#fff',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        padding: 20,
        overflowY: 'auto',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>通知详情</h3>
        <button onClick={onClose}>关闭</button>
      </div>

      {error && <p style={{ color: '#dc2626' }}>{error}</p>}

      {rec && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12, fontSize: 14 }}>
          <Field label="ID" value={<code>{rec.id}</code>} />
          <Field label="状态" value={<StatusBadge status={rec.status} />} />
          <Field label="尝试次数" value={`${rec.attempts} / ${rec.maxAttempts}`} />
          <Field label="目标" value={<code>{rec.method} {rec.url}</code>} />
          <Field label="幂等键" value={rec.idempotencyKey ?? '—'} />
          <Field label="最近状态码" value={rec.lastStatusCode ?? '—'} />
          <Field label="最近错误" value={<span style={{ color: '#dc2626' }}>{rec.lastError ?? '—'}</span>} />
          <Field label="下次投递" value={fmtTime(rec.nextAttemptAt)} />
          <Field label="创建时间" value={fmtTime(rec.createdAt)} />
          <Field label="更新时间" value={fmtTime(rec.updatedAt)} />

          <details>
            <summary>Headers</summary>
            <pre style={pre}>{JSON.stringify(rec.headers, null, 2)}</pre>
          </details>
          <details>
            <summary>Body</summary>
            <pre style={pre}>{JSON.stringify(rec.body, null, 2)}</pre>
          </details>

          {canRetry && (
            <button onClick={doRetry} disabled={busy} style={{ padding: '8px 16px', justifySelf: 'start' }}>
              {busy ? '重放中…' : '手动重试'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const pre: React.CSSProperties = {
  background: '#f6f8fa',
  padding: 10,
  borderRadius: 6,
  overflowX: 'auto',
  fontSize: 12,
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 8 }}>
      <span style={{ color: '#6b7280' }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{value}</span>
    </div>
  );
}
