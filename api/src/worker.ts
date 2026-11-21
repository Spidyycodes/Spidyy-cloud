import { createSpidyyHandler } from './app.ts';
import type { SpidyyEnv } from './storage.ts';

export default {
  async fetch(request: Request, env: SpidyyEnv): Promise<Response> {
    const handler = createSpidyyHandler(env);
    return handler(request);
  },
};
