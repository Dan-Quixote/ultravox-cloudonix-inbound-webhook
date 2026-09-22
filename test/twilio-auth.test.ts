import { describe, expect, test } from 'bun:test';
import { validateTwilioSignature } from '../src/twilio-auth';
import type { Env } from '../src/types';

const WEBHOOK_URL = 'https://example.com/myapp.php?foo=1&bar=2';
const AUTH_TOKEN = '12345';
const VALID_SIGNATURE = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';
const FORM = new URLSearchParams({
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
});

function env(overrides: Partial<Env> = {}): Env {
  return {
    ULTRAVOX_API_KEY: 'test',
    ULTRAVOX_AGENT_ID: 'test-agent',
    ULTRAVOX_SIP_DOMAIN: 'example.test',
    TWILIO_AUTH_TOKEN: AUTH_TOKEN,
    TWILIO_WEBHOOK_URL: WEBHOOK_URL,
    ...overrides,
  };
}

function request(signature?: string): Request {
  return new Request(WEBHOOK_URL, {
    method: 'POST',
    headers: signature ? { 'X-Twilio-Signature': signature } : {},
  });
}

describe('validateTwilioSignature', () => {
  test("accepts Twilio's published validation example", async () => {
    expect(await validateTwilioSignature(request(VALID_SIGNATURE), FORM, env())).toBe(true);
  });

  test('rejects a missing regional auth token', async () => {
    expect(
      await validateTwilioSignature(
        request(VALID_SIGNATURE),
        FORM,
        env({ TWILIO_AUTH_TOKEN: undefined }),
      ),
    ).toBe(false);
  });

  test('rejects a missing canonical webhook URL', async () => {
    expect(
      await validateTwilioSignature(
        request(VALID_SIGNATURE),
        FORM,
        env({ TWILIO_WEBHOOK_URL: undefined }),
      ),
    ).toBe(false);
  });

  test('rejects a missing signature', async () => {
    expect(await validateTwilioSignature(request(), FORM, env())).toBe(false);
  });

  test('rejects an invalid signature instead of bypassing it', async () => {
    expect(await validateTwilioSignature(request('not-a-valid-signature'), FORM, env())).toBe(false);
  });

  test('rejects when a signed form field is changed', async () => {
    const changed = new URLSearchParams(FORM);
    changed.set('To', '+18005559999');

    expect(await validateTwilioSignature(request(VALID_SIGNATURE), changed, env())).toBe(false);
  });

  test('rejects when the canonical URL does not match Twilio configuration', async () => {
    expect(
      await validateTwilioSignature(
        request(VALID_SIGNATURE),
        FORM,
        env({ TWILIO_WEBHOOK_URL: 'https://example.com/a-different-path' }),
      ),
    ).toBe(false);
  });
});
