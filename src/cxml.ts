/**
 * Build a CXML response that connects the caller to Ultravox via WebSocket.
 * Cloudonix supports <Connect><Stream> (Twilio WebSocket protocol compatible).
 */
export function buildStreamResponse(joinUrl: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(joinUrl)}" name="ultravox" />
  </Connect>
</Response>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/** Build a CXML error response that speaks a message and hangs up */
export function buildErrorResponse(message?: string): Response {
  const msg = message || 'We are experiencing technical difficulties. Please try again later.';
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>${escapeXml(msg)}</Say>
  <Hangup/>
</Response>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
