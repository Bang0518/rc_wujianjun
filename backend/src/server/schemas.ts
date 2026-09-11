import { HTTP_METHODS, NOTIFICATION_STATUSES } from '@notify/common';

/**
 * Fastify JSON Schema。既做请求校验，也做响应序列化。
 * 用框架内建能力落地 API 契约，避免额外引入校验库（如 zod）。
 */

export const createNotificationSchema = {
  body: {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: {
      url: { type: 'string', minLength: 1, pattern: '^https?://' },
      method: { type: 'string', enum: [...HTTP_METHODS] },
      headers: {
        type: 'object',
        additionalProperties: { type: 'string' },
      },
      // body 允许任意 JSON 值（对象/数组/字符串/数字/布尔/null）。
      body: {},
      maxAttempts: { type: 'integer', minimum: 1, maximum: 100 },
    },
  },
  headers: {
    type: 'object',
    properties: {
      'idempotency-key': { type: 'string', maxLength: 255 },
    },
  },
} as const;

export const listQuerySchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', enum: [...NOTIFICATION_STATUSES] },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      offset: { type: 'integer', minimum: 0, default: 0 },
    },
  },
} as const;

export const idParamsSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;
