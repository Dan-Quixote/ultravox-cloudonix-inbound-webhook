/**
 * Build a CXML response that connects the caller to Ultravox via WebSocket stream.
 */
export function buildStreamResponse(joinUrl: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you now.</Say>
  <Connect>
    <Stream url="${escapeXml(joinUrl)}" />
  </Connect>
  <Say>The call has ended. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/**
 * Build a CXML response that connects the caller to Ultravox via native SIP
 * with custom X- headers for caller context.
 *
 * Ultravox auto-converts SIP headers to template context:
 *   X-Caller-Name: "Dan" → {{ caller_name }} = "Dan"
 *   X-Current-Date: "Monday, Feb 22" → {{ current_date }} = "Monday, Feb 22"
 */
export function buildSipDialResponse(
  sipUri: string,
  context: Record<string, string>,
): Response {
  // Convert camelCase keys to X-Kebab-Case SIP headers
  const headers = Object.entries(context)
    .map(([key, value]) => {
      const headerName = `X-${camelToKebab(key)}`;
      return `    <Header name="${headerName}" value="${escapeXml(value)}"/>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you now.</Say>
  <Dial>
${headers}
    <Sip>${escapeXml(sipUri)}</Sip>
  </Dial>
  <Say>The call has ended. Goodbye.</Say>
  <Hangup/>
</Response>`;

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  });
}

/** Convert camelCase to Kebab-Title-Case: callerName → Caller-Name */
function camelToKebab(str: string): string {
  return str
    .replace(/([A-Z])/g, '-$1')
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('-');
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
