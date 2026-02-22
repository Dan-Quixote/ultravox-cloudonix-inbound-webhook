import type { Env } from './types';

/**
 * Validate Cloudonix webhook authenticity.
 * Cloudonix sends Authorization: Bearer {key} where key matches
 * the domain's authorization-api-key profile property.
 * If WEBHOOK_SECRET is not configured, validation is skipped (open mode).
 */
export function validateRequest(request: Request, env: Env): boolean {
  if (!env.WEBHOOK_SECRET) {
    return true;
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === env.WEBHOOK_SECRET;
  }

  return false;
}
