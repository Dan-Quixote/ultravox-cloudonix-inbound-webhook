import type { Env } from './types';

/**
 * Validate Cloudonix webhook authenticity.
 * Cloudonix sends Authorization: Bearer {key} where key matches
 * the domain's authorization-api-key profile property.
 * Missing configuration fails closed so the public compatibility route can
 * never silently become unauthenticated.
 */
export function validateRequest(request: Request, env: Env): boolean {
  if (!env.WEBHOOK_SECRET) {
    console.error('[cloudonix-auth] Rejected: WEBHOOK_SECRET is not configured');
    return false;
  }

  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return constantTimeEqual(authHeader.slice(7), env.WEBHOOK_SECRET);
  }

  return false;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
