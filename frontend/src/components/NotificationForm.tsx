import { useState } from 'react';
import { HTTP_METHODS, type HttpMethod, type NotificationRequest } from '@notify/common';
import { createNotification } from '../api.js';

interface HeaderRow {
  key: string;
  value: string;
}

/** 提交测试通知的表单：url / method / headers(KV) / body(JSON) / 幂等键。 */
export function NotificationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [url, setUrl] = useState('https://httpbin.org/status/200');
  const [method, setMethod] = useState<HttpMethod>('POST');
  const [headers, setHeaders] = useState<HeaderRow[]>([{ key: '', value: '' }]);
  const [bodyText, setBodyText] = useState('{\n  "event": "user_registered"\n}');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const setHeaderRow = (i: number, patch: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    let parsedBody: unknown;
    if (bodyText.trim()) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        setMessage({ ok: false, text: 'body 不是合法 JSON' });
        return;
      }
    }

    const headerObj: Record<string, string> = {};
    for (const { key, value } of headers) {
      if (key.trim()) headerObj[key.trim()] = value;
    }

    const payload: NotificationRequest = {
      url,
      method,
      headers: Object.keys(headerObj).length ? headerObj : undefined,
      body: parsedBody,
    };

    setBusy(true);
    try {
      const res = await createNotification(payload, idempotencyKey.trim() || undefined);
      setMessage({ ok: true, text: `已受理：${res.id}（${res.status}）` });
      onSubmitted();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
      <label style={{ display: 'grid', gap: 4 }}>
        目标 URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} required placeholder="https://..." />
      </label>

      <label style={{ display: 'grid', gap: 4, maxWidth: 160 }}>
        方法
        <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div style={{ display: 'grid', gap: 4 }}>
        <span>请求头</span>
        {headers.map((h, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Header"
              value={h.key}
              onChange={(e) => setHeaderRow(i, { key: e.target.value })}
            />
            <input
              placeholder="Value"
              value={h.value}
              onChange={(e) => setHeaderRow(i, { value: e.target.value })}
              style={{ flex: 1 }}
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => setHeaders((r) => [...r, { key: '', value: '' }])}
          style={{ justifySelf: 'start' }}
        >
          + 添加请求头
        </button>
      </div>

      <label style={{ display: 'grid', gap: 4 }}>
        Body (JSON)
        <textarea
          value={bodyText}
          onChange={(e) => setBodyText(e.target.value)}
          rows={5}
          style={{ fontFamily: 'monospace' }}
        />
      </label>

      <label style={{ display: 'grid', gap: 4 }}>
        Idempotency-Key（可选）
        <input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} placeholder="留空则不去重" />
      </label>

      <button type="submit" disabled={busy} style={{ justifySelf: 'start', padding: '8px 16px' }}>
        {busy ? '提交中…' : '提交通知'}
      </button>

      {message && (
        <div style={{ color: message.ok ? '#16a34a' : '#dc2626' }}>{message.text}</div>
      )}
    </form>
  );
}
