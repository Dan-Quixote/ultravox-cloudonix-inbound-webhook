import type { Env } from './types';

/**
 * Validate a Twilio form webhook using the algorithm documented by Twilio.
 *
 * Twilio signs the exact configured webhook URL followed by every form field,
 * sorted by field name, using HMAC-SHA1 and the regional account's primary
 * Auth Token. Both the token and canonical URL are required: an incomplete
 * production configuration must reject the request rather than silently open
 * the endpoint.
 */
export async function validateTwilioSignature(
  request: Request,
  params: URLSearchParams,
  env: Env,
): Promise<boolean> {
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  const webhookUrl = env.TWILIO_WEBHOOK_URL?.trim();
  const signature = request.headers.get('X-Twilio-Signature')?.trim();

  if (!authToken) {
    console.error('[twilio-auth] Rejected: TWILIO_AUTH_TOKEN is not configured');
    return false;
  }

  if (!webhookUrl) {
    console.error('[twilio-auth] Rejected: TWILIO_WEBHOOK_URL is not configured');
    return false;
  }

  if (!signature) {
    console.error('[twilio-auth] Rejected: X-Twilio-Signature is missing');
    return false;
  }

  try {
    const signingString = buildSigningString(webhookUrl, params);
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(authToken),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const expectedMac = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingString)),
    );
    const suppliedMac = decodeBase64(signature);

    return suppliedMac !== null && constantTimeEqual(expectedMac, suppliedMac);
  } catch (error) {
    console.error(
      '[twilio-auth] Rejected: signature validation failed',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

function buildSigningString(webhookUrl: string, params: URLSearchParams): string {
  const valuesByName = new Map<string, string[]>();

  for (const [name, value] of params) {
    const values = valuesByName.get(name) ?? [];
    values.push(value);
    valuesByName.set(name, values);
  }

  let result = webhookUrl;
  for (const name of [...valuesByName.keys()].sort()) {
    // Match the Twilio helper's treatment of repeated form fields.
    for (const value of [...new Set(valuesByName.get(name))].sort()) {
      result += name + value;
    }
  }

  return result;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function constantTimeEqual(expected: Uint8Array, supplied: Uint8Array): boolean {
  if (expected.length !== supplied.length) return false;

  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected[index] ^ supplied[index];
  }

  return mismatch === 0;
}
