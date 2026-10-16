# Test Strategy — Subscription & Billing Service

## 1. Scope and assumptions

This repository contains a small **test fixture**, not a production billing service. It exists to demonstrate test architecture and business-rule validation in the absence of a supplied service implementation.

Assumptions encoded in the fixture:
- `basic` costs 1900 USD and starts with a 7-day trial; it is not charged at creation.
- `pro` costs 4900 USD and is charged immediately.
- The only seeded customers are `cust_test_001` and `cust_test_002`.
- A provider decline becomes a failed invoice and `past_due`; a provider timeout creates an `unknown` invoice and `past_due`, because the provider may have processed a timed-out request.
- Authenticated webhook event IDs are idempotency keys. Every first-seen, authenticated event is recorded, including events ignored because of state or ordering.
- A failure with `retries_exhausted: true` transitions a non-canceled subscription to `canceled`.
- A late `payment.failed` for an invoice already marked paid is ignored.
- An invoice ID already associated with another subscription is ignored and recorded; it cannot be reassigned by a webhook.
- A retry success for the same failed invoice updates that invoice in place, preserving one invoice row. A refunded invoice stays refunded if a later success/failure arrives.
- Refund marks a paid invoice `refunded`; it does not alter subscription status in this simplified model.
- `payment.succeeded` creates or records a paid invoice and can activate `trialing` or `past_due`; canceled subscriptions are immutable.

These are explicit fixture decisions where the assignment leaves implementation details open; confirm them with the target service contract before reusing the suite against a real API.

## 2. Test levels

| Level | What is verified |
|---|---|
| API contract | Create, retrieve, cancel; response status/body; invalid plan, missing fields, unknown customer/subscription |
| State machine | All specified valid transitions and prohibited reactivation of canceled subscriptions |
| Persistence | Subscription, invoice, webhook-event and audit records; consistency between API and persisted view |
| External integration seam | Exact provider arguments/call count; success, decline, timeout outcomes |
| End-to-end | API request or signed webhook -> service logic -> state/persistence assertions |

## 3. What is real vs mocked

- **Real in this fixture:** Express HTTP routing, request validation, raw-body signature verification, transition checks, repository calls, and Playwright HTTP requests.
- **In-memory:** customers, subscriptions, invoices, webhook events, audit records. This is queryable but not durable across process restarts.
- **Mocked:** payment provider. It never calls a real payment network. Test-only endpoints configure its deterministic outcome and expose recorded calls.
- **Not implemented:** real payment provider SDK, durable database, authentication/authorization, production secrets management, background retry scheduler, notification delivery, proration, tax, multi-currency pricing, distributed locks, and production observability.

## 4. Patterns and architecture

- **State machine / transition table:** `src/domain.js` centralizes permitted status transitions. Invalid transitions cannot be applied through the `transition()` function.
- **Builder:** `SubscriptionBuilder` and `WebhookBuilder` make scenario setup intent-focused and reduce repeated payload literals.
- **Adapter / dependency injection:** `MockPaymentProvider` implements the `charge()` seam injected into `createApp()`. It supports success, decline, and timeout.
- **Repository:** `InMemoryRepository` isolates persistence operations from route handlers and test assertions.
- **API client object:** `BillingApiClient` encapsulates HTTP endpoint calls. `PersistenceVerifier` centralizes state/invariant assertions.

## 5. API contracts in this fixture

### Create
`POST /subscriptions`
```json
{ "customer_id": "cust_test_001", "plan": "basic", "payment_method_id": "pm_test_visa_4242" }
```
Returns `201` and `{ "subscription": ... }`; immediate-charge plans also return `invoice`.

### Retrieve
`GET /subscriptions/{id}` returns `200 { "subscription": ... }`, or `404`.

### Cancel
`POST /subscriptions/{id}/cancel` returns `200` and canceled subscription; repeated cancellation returns `409`.

### Webhook
`POST /webhooks/payment-provider`, JSON body signed as HMAC-SHA256 over the exact raw request bytes in `X-Provider-Signature`. Supported types: `payment.succeeded`, `payment.failed`, `payment.refunded`. Invalid signature is `401`; malformed/invalid payload is `400`; unknown subscription is `404`; duplicate event ID is a successful `200` no-op.

## 6. Persistence entities and invariants

- `subscriptions`: current status, plan, customer, payment method, trial timestamps.
- `invoices`: amount/currency/status/provider reference/idempotency key.
- `webhook_events`: first-seen authenticated event payload, timestamp, processing outcome.
- `audit_events`: status transition history and reason.

The tests assert:
1. Active state follows a persisted paid invoice.
2. Canceled subscriptions never reactivate from a later webhook.
3. Replaying the same event ID does not add a second event, invoice, transition, or provider call.
4. A paid invoice is not overwritten by a late failure for that invoice.
5. Invalid requests/signatures do not create subscriptions/events or invoke the provider.
6. Provider amount, customer, payment method, currency, and idempotency reference are checked.
7. API-visible status and repository-visible status agree.

Test isolation uses `POST /__test/reset` before every test. It resets all in-memory data and provider call history, avoiding stale-state false positives.

## 7. Webhook strategy

Tests build event payloads and sign `JSON.stringify(payload)` with the fixture secret. Negative cases include missing/forged signatures and malformed JSON with a valid signature. Duplicate event IDs are no-ops. An out-of-order failure for an already-paid invoice is ignored. Canceled subscriptions are terminal.

## 8. Red / Blue / Green

Recommended development sequence:
- **Red:** write one failing test for duplicate webhook processing and canceled-state reactivation.
- **Blue:** implement the event ID store and central transition table to satisfy those tests.
- **Green:** move request construction into `BillingApiClient`, payload creation into builders, and database checks into `PersistenceVerifier`; run the full suite after each refactor.

## 9. Known limitations and risks

- In-memory persistence cannot validate SQL constraints, transactions, crash recovery, or true durability.
- Single-process tests do not prove race safety for concurrent duplicate webhooks. A production implementation should use a database unique constraint on event ID and transactional/locking semantics.
- Test-only `__test` endpoints are intentionally exposed by this local fixture. They must not be deployed in a production service.
- The fixture accepts a fixed local webhook secret by default. Configure secrets outside source code in a real system.
- Refund behavior and whether refund should cancel/downgrade a subscription are business-contract decisions.
- Amount/currency validation and invoice identity/ownership validation are simplified and should be hardened for production.
- No retry scheduler exists; retries are simulated with webhook payloads.
- Provider timeout is modeled as an `unknown` invoice, but reconciliation/idempotent retry behavior is not implemented.
- The fixture's initial `pro` creation begins at `trialing` and transitions to `active` or `past_due` after charge result to keep all state changes explicit.

## 10. Suggested production hardening

Use durable SQL persistence and transactions; enforce unique provider event IDs and invoice IDs; validate signature timestamp/replay windows; verify invoice/subscription/customer ownership and amount/currency; make provider idempotency keys stable across retries; add concurrency tests; and disable all test-only endpoints outside test environments.
