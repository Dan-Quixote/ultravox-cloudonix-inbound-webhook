/**
 * Handle call status callbacks from Cloudonix.
 * Logs call state transitions for observability.
 */
export async function handleCallStatus(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as Record<string, string>;

    const callSid = body.CallSid || 'unknown';
    const status = body.CallStatus || 'unknown';
    const duration = body.CallDuration || '0';

    console.log(`Call ${callSid}: status=${status} duration=${duration}s`);
  } catch (err) {
    // Status callbacks are fire-and-forget — log but don't fail
    console.warn('Failed to parse status callback:', err instanceof Error ? err.message : err);
  }

  return new Response('<Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
