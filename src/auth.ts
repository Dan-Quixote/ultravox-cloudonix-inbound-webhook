import type { Env } from './types';

/**
 * Validate Cloudonix webhook authenticity via X-CX-APIKey header.
 * If WEBHOOK_SECRET is not configured, validation is skipped (open mode).
 */
export function validateRequest(request: Request, env: Env): boolean {
  if (!env.WEBHOOK_SECRET) {
    return true;
  }

  const apiKey = request.headers.get('X-CX-APIKey');
  return apiKey === env.WEBHOOK_SECRET;
}
