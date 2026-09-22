import { expect, test } from 'bun:test';
import { createBookingToolHeaders } from '../src/providers/booking';

test('pre-call booking auth matches the shared Worker contract', async () => {
  const headers = await createBookingToolHeaders(
    'test-root-secret-at-least-32-characters',
    'org-123',
    'get-bookings',
    'call-123',
    new Date('2026-09-10T10:00:00.000Z'),
  );

  expect(headers.Authorization).toBe(
    'Bearer bm_v1_eb43a03b41dfa07dd561c1d350797fca88c6bc54d36e0a9b1527662ecd0d69e3',
  );
  expect(headers['X-Ultravox-Signature']).toBe(
    '8f2faaaec1bbcfe85e2a386a12d0864876b9b8061009d2bdc9f3ae76fd4586e8',
  );
});
