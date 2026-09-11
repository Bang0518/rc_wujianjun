import type {
  CreateNotificationResponse,
  ListResponse,
  NotificationRecord,
  NotificationRequest,
  NotificationStatus,
  StatsResponse,
} from '@notify/common';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export function createNotification(
  body: NotificationRequest,
  idempotencyKey?: string,
): Promise<CreateNotificationResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return req<CreateNotificationResponse>('/notifications', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

export function listNotifications(params: {
  status?: NotificationStatus;
  limit?: number;
  offset?: number;
}): Promise<ListResponse> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  q.set('limit', String(params.limit ?? 50));
  q.set('offset', String(params.offset ?? 0));
  return req<ListResponse>(`/notifications?${q.toString()}`);
}

export function getNotification(id: string): Promise<NotificationRecord> {
  return req<NotificationRecord>(`/notifications/${id}`);
}

export function retryNotification(id: string): Promise<NotificationRecord> {
  return req<NotificationRecord>(`/notifications/${id}/retry`, { method: 'POST' });
}

export function getStats(): Promise<StatsResponse> {
  return req<StatsResponse>('/stats');
}
