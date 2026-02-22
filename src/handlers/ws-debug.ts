/**
 * WebSocket debug proxy — sits between Cloudonix and Ultravox.
 * Logs all messages flowing in both directions to identify protocol mismatches.
 */
export async function handleWebSocketDebug(request: Request, ultravoxJoinUrl: string): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket', { status: 426 });
  }

  const [client, server] = Object.values(new WebSocketPair());

  // Connect to Ultravox
  const ultravoxWs = new WebSocket(ultravoxJoinUrl);

  let messageCount = 0;

  server.accept();

  // Cloudonix → Ultravox (forward all messages)
  server.addEventListener('message', (event) => {
    messageCount++;
    const data = typeof event.data === 'string' ? event.data : '<binary>';

    if (typeof event.data === 'string') {
      try {
        const parsed = JSON.parse(event.data);
        const eventType = parsed.event || 'unknown';
        if (eventType === 'media') {
          if (messageCount <= 5 || messageCount % 50 === 0) {
            console.log(`[CX→UV] #${messageCount} media: track=${parsed.media?.track}, payload_len=${parsed.media?.payload?.length || 0}, chunk=${parsed.media?.chunk}`);
          }
        } else {
          console.log(`[CX→UV] #${messageCount} ${eventType}:`, data.substring(0, 300));
        }
      } catch {
        console.log(`[CX→UV] #${messageCount} raw:`, data.substring(0, 200));
      }
    } else {
      console.log(`[CX→UV] #${messageCount} binary: ${(event.data as ArrayBuffer).byteLength} bytes`);
    }

    if (ultravoxWs.readyState === WebSocket.OPEN) {
      ultravoxWs.send(event.data);
    }
  });

  // Ultravox → Cloudonix (forward all messages)
  let uvMessageCount = 0;
  ultravoxWs.addEventListener('message', (event) => {
    uvMessageCount++;
    const data = typeof event.data === 'string' ? event.data : '<binary>';

    if (typeof event.data === 'string') {
      try {
        const parsed = JSON.parse(event.data);
        const eventType = parsed.event || 'unknown';
        if (eventType === 'media') {
          if (uvMessageCount <= 5 || uvMessageCount % 50 === 0) {
            console.log(`[UV→CX] #${uvMessageCount} media: payload_len=${parsed.media?.payload?.length || 0}, streamSid=${parsed.streamSid?.substring(0, 12)}`);
          }
        } else {
          console.log(`[UV→CX] #${uvMessageCount} ${eventType}:`, data.substring(0, 300));
        }
      } catch {
        console.log(`[UV→CX] #${uvMessageCount} raw:`, data.substring(0, 200));
      }
    } else {
      console.log(`[UV→CX] #${uvMessageCount} binary: ${(event.data as ArrayBuffer).byteLength} bytes`);
    }

    if (server.readyState === WebSocket.OPEN) {
      server.send(event.data);
    }
  });

  server.addEventListener('close', (event) => {
    console.log(`[CX] WebSocket closed: code=${event.code} reason=${event.reason}`);
    ultravoxWs.close();
  });

  ultravoxWs.addEventListener('close', (event) => {
    console.log(`[UV] WebSocket closed: code=${event.code} reason=${event.reason}`);
    server.close();
  });

  ultravoxWs.addEventListener('error', (event) => {
    console.error(`[UV] WebSocket error`);
  });

  server.addEventListener('error', (event) => {
    console.error(`[CX] WebSocket error`);
  });

  console.log(`[PROXY] WebSocket debug proxy started → ${ultravoxJoinUrl}`);

  return new Response(null, { status: 101, webSocket: client });
}
