import { defineWorkspace } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// 把 @notify/common 直接指向源码，测试无需先构建 common 包。
const commonSrc = fileURLToPath(new URL('./common/src/index.ts', import.meta.url));
const alias = { '@notify/common': commonSrc };

export default defineWorkspace([
  {
    resolve: { alias },
    test: {
      name: 'backend',
      root: './backend',
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  },
  {
    resolve: { alias },
    test: {
      name: 'e2e',
      root: '.',
      environment: 'node',
      include: ['test/**/*.test.ts'],
      testTimeout: 30000,
      hookTimeout: 30000,
    },
  },
]);
