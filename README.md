# BookingMate inbound call router

A Cloudflare Worker that connects inbound phone calls to [Ultravox](https://www.ultravox.ai/) AI receptionists. It supports two different telephony routes: Twilio calls the Worker directly, while providers such as Zadarma or NetLIP can use [Cloudonix](https://www.cloudonix.io/) as a programmable compatibility bridge.

Cloudonix is not in the current UK Twilio call path. See [the routing and security source of truth](docs/call-routing-and-security.md) before changing either route.

Created and tested on the fictitious Los Naranjos Golf Club in Seville.

## Quick Start

1. **Create your Ultravox agent** — Set up a SIP-enabled agent in the [Ultravox dashboard](https://www.ultravox.ai/) and note the agent ID and SIP domain.
2. **Set up your Cloudonix account** — Sign up at [Cloudonix](https://www.cloudonix.io/) and create a domain. Set the domain's voice application webhook to your Worker URL (step 4).
3. **Point your Zadarma number to Cloudonix** — In Zadarma, go to *Your numbers* → select your number → *External server* tab → enable "External server (SIP URI)" → set the server address to `yournumber@border.cloudonix.io`.
4. **Deploy this Worker** — Clone this repo, add your agent ID and SIP domain to `wrangler.toml`, then run `bun run deploy`.
5. **Call your number** — Your Zadarma number now routes through Cloudonix → this Worker → Ultravox, with caller context injected automatically.

## How It Works

```
UK:    caller → business forwards call → Twilio → Worker /twilio-inbound → Ultravox
Spain: caller → business forwards call → Zadarma/NetLIP → Cloudonix → Worker /inbound → Ultravox
```

In both cases the Worker uses the called BookingMate number to find the correct business and receptionist, optionally loads booking context, and returns instructions that connect the same live call to the correct Ultravox SIP agent.

## Why This Architecture Exists

This Worker exists because of a gap between three services that don't natively connect the way we need them to:

1. **Ultravox has no inbound webhook.** Unlike Retell (which fires a pre-connect webhook and accepts `dynamic_variables` in the response), Ultravox only receives SIP calls. There is no built-in hook to inject caller-specific context (name, booking history) before the agent speaks. Ultravox supports `templateContext` at call creation time via the API, but if a SIP call arrives directly, there's no middleware to populate it.

2. **Zadarma has no dynamic call routing.** Zadarma is the most common VoIP provider in Spain, but its webhooks are fire-and-forget (`notify_start`, etc.) — you cannot return a routing decision in the webhook response. Calls can only forward to a fixed SIP destination. There's no way to do a CRM lookup and modify the call routing based on the result.

3. **Twilio would solve this, but it cannot currently supply the Spanish number setup BookingMate requires.** Twilio's programmable voice can do the lookup + SIP forwarding in a single webhook response. The required Spanish number type and availability are the constraint for our use case.

**Cloudonix fills the gap.** It's a programmable telephony routing layer that fires an HTTP webhook on inbound calls and **waits for a CXML response** (TwiML-compatible). This gives us the middleware layer to:
- Look up the caller in a CRM/booking system
- Inject that context as SIP `X-` headers
- Route the call to Ultravox with full personalization — all in a single request-response cycle

Twilio uses this Worker directly for tenant routing and pre-call context; it does not need Cloudonix. The Cloudonix route remains necessary for supported providers that cannot perform this programmable request-response step themselves.

## Key Features

- **Native SIP trunking** — no WebSocket bridging, superior audio quality and lower latency
- **Caller context enrichment** — passes name, booking history, and custom fields to the AI agent before the call connects
- **Zero-latency context delivery** — context arrives via SIP `X-` headers in the INVITE, not via a mid-call API lookup
- **3-second lookup timeout** — if the CRM lookup is slow, the call proceeds with a generic greeting rather than keeping the caller waiting
- **Date/time injection** — current date and time (configurable timezone) injected into every call for context-aware agent responses
- **First-name personalization** — full name from CRM is trimmed to first name for natural greetings
- **Webhook authentication** — required Bearer token validation on the `/inbound` endpoint
- **Health check endpoint** — `/health` for uptime monitoring
- **Zero cold-start overhead** — Cloudflare Workers edge runtime, globally distributed

## File Structure

```
src/
├── index.ts                 Router: /inbound, /status, /health, /ws-proxy
├── types.ts                 TypeScript interfaces (Env, CloudonixPayload, CallerContext, TemplateContext)
├── cxml.ts                  CXML response builders (buildSipDialResponse, buildErrorResponse)
├── auth.ts                  Webhook authentication (Bearer token validation)
├── handlers/
│   ├── inbound-call.ts      Core handler: parse webhook → lookup caller → build SIP dial response
│   ├── call-status.ts       Call status callback handler
│   └── ws-debug.ts          WebSocket debug proxy (development only)
└── providers/
    ├── lookup.ts             Caller context lookup (POST to configurable webhook, 3s timeout)
    └── ultravox.ts           Legacy Ultravox API provider (kept for reference, not used in SIP flow)
```

## CXML Response

The Worker returns CXML that Cloudonix executes to dial the Ultravox SIP agent:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Connecting you now.</Say>
  <Dial>
    <Header name="X-Caller-Name" value="John"/>
    <Header name="X-Caller-Phone" value="+1234567890"/>
    <Header name="X-Caller-History" value="Existing booking: Monday, February 23 at 10:00 AM"/>
    <Header name="X-Current-Date" value="Saturday, February 22, 2026"/>
    <Header name="X-Current-Time" value="9:15 PM"/>
    <Sip>sip:agent_your-agent-id@your-sip-domain.example.com</Sip>
  </Dial>
  <Say>The call has ended. Goodbye.</Say>
  <Hangup/>
</Response>
```

## SIP Header to Template Variable Mapping

Ultravox automatically maps SIP `X-` headers from the INVITE to template variables in your agent's system prompt. No configuration needed on the Worker side.

| SIP Header | Ultravox Template Variable | Example Value |
|---|---|---|
| `X-Caller-Name` | `{{caller_name}}` | `John` |
| `X-Caller-Phone` | `{{caller_phone}}` | `+1234567890` |
| `X-Caller-History` | `{{caller_history}}` | `Existing booking: Feb 23 at 10 AM` |
| `X-Current-Date` | `{{current_date}}` | `Saturday, February 22, 2026` |
| `X-Current-Time` | `{{current_time}}` | `9:15 PM` |

In your Ultravox agent's system prompt, reference these as `{{caller_name}}`, `{{caller_history}}`, etc.

## Caller Context Lookup Webhook

When `LOOKUP_URL` is configured, the Worker sends a POST request for every inbound call:

**Request (from Worker to your webhook):**
```json
POST https://your-webhook.example.com/lookup
Content-Type: application/json

{
  "call_inbound": {
    "from_number": "+1234567890"
  }
}
```

**Response (from your webhook to Worker):**
```json
{
  "name": "John Hammond",
  "history": "Existing booking: Monday, February 23 at 10:00 AM"
}
```

Any field in the response is passed through as an `X-` header. The `name` field is automatically trimmed to first name only for the `X-Caller-Name` header.

If the lookup URL is not set, or if the request times out or fails, the Worker falls back gracefully — the call still connects, the agent just won't have caller-specific context.

## Setup

### Prerequisites

- [Bun](https://bun.sh/) (package manager — do not use npm or yarn)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`bun add -g wrangler`)
- A Cloudflare account with Workers enabled
- A Cloudonix account with a configured domain
- An Ultravox account with a SIP-enabled agent

### 1. Clone and Install

```bash
git clone https://github.com/your-username/cloudonix-inbound-worker.git
cd cloudonix-inbound-worker
bun install
```

### 2. Configure wrangler.toml

Edit `wrangler.toml` and set your Ultravox agent details:

```toml
name = "cloudonix-inbound-worker"
main = "src/index.ts"
compatibility_date = "2025-02-14"

[vars]
ULTRAVOX_AGENT_ID = "your-agent-id"
ULTRAVOX_SIP_DOMAIN = "your-sip-domain.example.com"
```

`ULTRAVOX_AGENT_ID` is the UUID of your Ultravox agent. `ULTRAVOX_SIP_DOMAIN` is the SIP domain shown in your Ultravox agent's SIP settings. The Worker will construct the SIP URI as `sip:agent_{ULTRAVOX_AGENT_ID}@{ULTRAVOX_SIP_DOMAIN}`.

### 3. Set Secrets

```bash
# Required: authenticates Cloudonix webhook requests
wrangler secret put WEBHOOK_SECRET

# Required for the direct Twilio route: IE1 primary Auth Token
wrangler secret put TWILIO_AUTH_TOKEN

# Required for authenticated pre-call booking context
wrangler secret put BOOKING_TOOLS_SIGNING_SECRET

# Required for operational alerts on rejected DID routing
wrangler secret put ROUTING_ALERT_WEBHOOK_URL

# Optional: enables caller context lookup (n8n, Make, or any HTTP endpoint)
wrangler secret put LOOKUP_URL
```

`WEBHOOK_SECRET` must match the API key configured in Cloudonix's webhook settings. If it is missing or wrong, the Worker rejects the request.

`LOOKUP_URL` is the full URL of your caller context webhook. Omit it entirely if you don't need CRM lookups.

### 4. Local Development

```bash
bun run dev
```

This starts a local Wrangler dev server. You can use [ngrok](https://ngrok.com/) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose it for webhook testing.

### 5. Deploy

```bash
bun run deploy
```

Your Worker will be live at `https://cloudonix-inbound-worker.your-subdomain.workers.dev`.

### 6. Configure Cloudonix

In your Cloudonix domain settings, set the inbound call webhook URL to your deployed Worker:

```
https://cloudonix-inbound-worker.your-subdomain.workers.dev/inbound
```

Set the webhook method to `POST` and configure the API key to match your `WEBHOOK_SECRET`.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/inbound` | `POST` | Main webhook — receives Cloudonix call events |
| `/status` | `POST` | Call status callback (logs call lifecycle events) |
| `/health` | `GET` | Health check — returns `200 OK` with status payload |
| `/ws-proxy` | `GET` | WebSocket debug proxy (development use only) |

## Timezone Configuration

The Worker injects the current date and time using the `Europe/Madrid` timezone by default. To change it, edit the `timeZone` values in `src/handlers/inbound-call.ts`:

```typescript
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', // change to your timezone
  ...
});
```

Any [IANA timezone string](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) is valid.

## Logs

Stream live logs from the deployed Worker:

```bash
bun run tail
```

The Worker logs the caller number, call SID, resolved SIP URI, and the full template context passed to Ultravox for every inbound call.

## Environment Variables Reference

| Variable | Type | Required | Description |
|---|---|---|---|
| `ULTRAVOX_AGENT_ID` | `wrangler.toml` var | Yes | Ultravox agent UUID |
| `ULTRAVOX_SIP_DOMAIN` | `wrangler.toml` var | Yes | Ultravox SIP domain |
| `WEBHOOK_SECRET` | Secret | Recommended | Bearer token for Cloudonix webhook auth |
| `LOOKUP_URL` | Secret | No | Caller context lookup endpoint URL |

## Stack

- **Runtime:** Cloudflare Workers (edge, globally distributed)
- **Language:** TypeScript
- **Package manager:** Bun
- **Telephony:** Cloudonix CXML + SIP trunking
- **AI voice:** Ultravox SIP agent
- **Context enrichment:** Any HTTP webhook (n8n, Make, custom)

## License

MIT
