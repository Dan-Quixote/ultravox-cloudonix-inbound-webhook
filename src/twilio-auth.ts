import type { Env } from './types';

/**
 * Validate Twilio webhook request signatures.
 *
 * Twilio signs every webhook with HMAC-SHA1 using your Auth Token.
 * The signature is sent in the X-Twilio-Signature header.
 *
 * Signing input = request URL + sorted form params concatenated as key=value pairs.
 * See: https://www.twilio.com/docs/usage/security#validating-requests
 */
export async function validateTwilioSignature(
  request: Request,
  formData: FormData,
  env: Env,
): Promise<boolean> {
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn('[twilio-auth] TWILIO_AUTH_TOKEN not set — skipping signature validation');
    return true;
  }

  const signature = request.headers.get('X-Twilio-Signature');
  if (!signature) {
    console.error('[twilio-auth] Missing X-Twilio-Signature header');
    return false;
  }

  // Build the signing string: URL + sorted params
  const url = request.url;
  const params: [string, string][] = [];
  formData.forEach((value, key) => {
    params.push([key, value as string]);
  });
  params.sort((a, b) => a[0].localeCompare(b[0]));

  let signingString = url;
  for (const [key, value] of params) {
    signingString += key + value;
  }

  // HMAC-SHA1 with auth token
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signingString));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }

  if (mismatch !== 0) {
    console.error('[twilio-auth] Signature mismatch');
    return false;
  }

  return true;
}
