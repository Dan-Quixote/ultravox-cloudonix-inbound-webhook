# BookingMate inbound call routing and security

This repository contains one Cloudflare Worker with two separate inbound routes. Cloudonix is not part of every BookingMate call.

## Route A: current UK Twilio numbers

```text
Customer calls the business's normal mobile or landline
  -> the business's carrier forwards the live call
  -> the business's BookingMate Twilio number
  -> Twilio sends a signed request to /twilio-inbound
  -> this Worker verifies Twilio and looks up that Twilio number in AGENT_ROUTING
  -> optional pre-call booking history and availability lookup
  -> this Worker returns TwiML telling Twilio which Ultravox SIP agent to call
  -> Twilio connects the same live call to that Ultravox receptionist
```

Cloudonix does not participate in this route. The called Twilio number is the tenant-routing key because it is the number Twilio reports to the Worker after call forwarding.

## Route B: Spain and non-programmable number providers

```text
Customer calls the business's normal mobile or landline
  -> the business's carrier forwards the live call
  -> the business's BookingMate number from Zadarma, NetLIP, or a similar provider
  -> that provider sends the live call to Cloudonix
  -> Cloudonix sends an authenticated request to /inbound and waits for CXML
  -> this Worker looks up the BookingMate number in AGENT_ROUTING
  -> optional pre-call booking history and availability lookup
  -> this Worker returns CXML telling Cloudonix which Ultravox SIP agent to call
  -> Cloudonix connects the same live call to that Ultravox receptionist
```

Cloudonix supplies the programmable pause-and-route step that is missing from providers whose event webhooks cannot wait for a routing/context response. This compatibility route remains part of the Spain plan where the required Twilio numbering is unavailable or unsuitable.

## What ENG-41 protects

Twilio calls `/twilio-inbound` over the public internet. Twilio signs the request with the primary Auth Token for the Twilio region processing the number. The Worker must verify that signature before using any phone numbers or requesting booking context.

A forged HTTP request is not itself a telephone call and the returned TwiML is not automatically executed by Twilio. The concrete risks are instead:

- an outsider could query the public pre-call path and potentially receive caller history or availability in the TwiML response;
- forged requests could create unwanted lookup traffic and logs;
- once ENG-40 grants the inbound Worker authenticated access to booking tools, a forged inbound request could misuse that trusted access unless ENG-41 is closed first.

The April 2026 audit did identify this control. Validation was then bypassed when a US1 token failed against IE1-signed requests. The process failure was leaving that exception active while the audit tracker described the control as complete.

Production requirements:

- `TWILIO_AUTH_TOKEN` is a Worker secret containing the IE1 region's primary Auth Token;
- `TWILIO_WEBHOOK_URL` exactly matches the HTTPS voice URL configured on every Twilio number;
- a missing token, missing signature, wrong URL, changed form field, or signature mismatch is rejected;
- deployment is not considered complete until a real forwarded call succeeds and an unsigned request receives `403`.

## What ENG-42 protects

`AGENT_ROUTING` maps each BookingMate number to one business's Ultravox receptionist. An unknown number must never fall through to a shared default receptionist. Both routes therefore need the same fail-closed behaviour: play a neutral unavailable message, end the call, and emit a structured operational error without exposing tenant data.

`ALLOW_LEGACY_AGENT_FALLBACK=true` may be used only with a non-production `ENVIRONMENT` for temporary local testing. Production ignores that switch and always requires a valid KV route.

Called numbers must already be canonical E.164 before KV lookup. Missing, malformed,
unknown, and deprovisioned DIDs return the same neutral unavailable response.
Configure the secret `ROUTING_ALERT_WEBHOOK_URL` to send a structured
operational alert for every rejected route; alert delivery failures are logged
without routing the call to a fallback tenant.

## Related systems

- `booking-agent-prompt-refinery` writes the number-to-agent KV mapping during activation.
- `booking-tools-shared` supplies caller history, availability, and booking actions. ENG-40 must authenticate and tenant-bind those calls.
- `retell-signature-verify` is the analogous post-call pattern: verify the platform before trusting its internet request. ENG-41 applies that principle before a Twilio call is routed.

## ENG-40 authenticated booking-tool contract

Knowing an `organization_id` is not authority. Each booking-tool request now needs a Bearer token derived for the exact organization and action plus a signed call ID and fresh timestamp. Every request also receives short-lived replay detection. The same root secret is installed separately in the agent provisioner, inbound Worker, and booking-tools Worker; it is never committed.

Ultravox agents receive per-action tokens through temporary-tool `authTokens` and a per-organization call signature secret through call-template `sharedSecrets`. The inbound Worker generates the same headers for its pre-call `get-bookings` and `check-availability` requests.

Enforcement must be deployed last, after existing agents are backfilled and the inbound Worker is signing requests. Otherwise live booking tools and pre-call context will fail closed, as designed.
