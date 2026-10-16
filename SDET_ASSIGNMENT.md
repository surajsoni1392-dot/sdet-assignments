# Subscription & Billing Service — Software Developer in Test Assignment

## Overview

Design and implement an automated test solution for a **Subscription & Billing Service**.

This assignment evaluates senior **Software Developer in Test / QA Automation Engineer** candidates on the kind of problems that matter in real backend systems:

- object-oriented test framework design, not script-style test files
- deliberate use of design patterns where they earn their keep
- API and persistence validation for a stateful, billed resource
- correct behavior under asynchronous, out-of-order, and duplicate webhook delivery
- mocking an external payment provider instead of assuming a real one
- test architecture and maintainability

This is intentionally **not** a basic CRUD API testing exercise. The goal is to assess whether you can design and build automation — and the object-oriented scaffolding underneath it — that gives real confidence in a stateful, billed workflow.

Focus on **clarity, design quality, coverage strategy, and correctness** over building a huge framework.

---

## Problem Statement

You are given (or will build a minimal fixture for) a backend service in the **subscription billing domain**.

The service manages subscriptions that move through a lifecycle — trial, active, past due, canceled — driven by two things: direct API calls, and asynchronous webhook events from an external payment provider notifying the service that a charge succeeded, failed, or was refunded.

Your task is **not** to build the service itself from scratch unless you choose to create a small stub or test fixture to support your tests.

Your task is to design and implement an **automated validation suite** for a Subscription & Billing Service that proves behavior at multiple levels:

1. **API level** — subscription CRUD, cancellation, plan changes
2. **State-machine level** — only valid lifecycle transitions occur, driven by API calls and webhook events
3. **Database / persistence level** — subscriptions, invoices, and payment events are stored correctly
4. **External-integration level** — the payment provider is a dependency you mock, not a real service

You may simulate the payment provider and webhook delivery as needed, but your design must make clear what is real, what is a test double, and what is being verified.

---

## Time Expectation

Please spend **3–5 hours** on this assignment.

We do not expect a massive enterprise test platform. We care more about:

- sound test strategy
- deliberate, well-justified use of object orientation and design patterns
- ability to validate a stateful workflow and its persisted side effects
- maintainable test architecture
- clear documentation of tradeoffs and risks

A smaller but deeply thoughtful solution is preferred over a wide but shallow one.

---

## Domain Context

Assume the Subscription & Billing Service has behavior roughly like the following.

### Core Operations

```text
POST   /subscriptions              create a subscription for a customer + plan
GET    /subscriptions/{id}
POST   /subscriptions/{id}/cancel
POST   /webhooks/payment-provider  inbound event from the external payment provider
```

Example subscription creation request:

```json
{
  "customer_id": "cust_001",
  "plan": "pro",
  "payment_method_id": "pm_test_visa_4242"
}
```

Example inbound webhook payload (from the payment provider, signed):

```json
{
  "event_id": "evt_8c1f4f0b",
  "type": "payment.succeeded",
  "subscription_id": "sub_001",
  "invoice_id": "inv_001",
  "amount": 4900,
  "currency": "USD"
}
```

Header on the webhook request:

```text
X-Provider-Signature: <hmac signature over the raw body>
```

### Plans

Assume at least two plan tiers exist (e.g. `basic`, `pro`) with different prices and trial lengths. Plan-specific pricing/proration behavior is a natural place to apply a design pattern rather than branching logic scattered across the codebase.

### Subscription Lifecycle

At minimum, assume these states and transitions:

```text
trialing --(trial ends, first charge succeeds)--> active
trialing --(trial ends, first charge fails)------> past_due
active   --(recurring charge fails)---------------> past_due
past_due --(retry charge succeeds)----------------> active
past_due --(retries exhausted)--------------------> canceled
active   --(customer/API cancel)------------------> canceled
trialing --(customer/API cancel)------------------> canceled
```

Any transition not shown above is invalid and must be rejected or ignored, not silently accepted.

### Expected Service Behaviors

At minimum, assume the system should support:

- creating a subscription that starts in `trialing` or is charged immediately, per plan config
- valid state transitions only — invalid transitions must not be possible via API or webhook
- webhook-driven state changes (`payment.succeeded`, `payment.failed`, `payment.refunded`)
- idempotent webhook processing — the payment provider may redeliver the same event
- cancellation that stops future billing and is irreversible via further webhooks
- durable, queryable subscription and invoice/payment records
- an auditable event history per subscription

You may extend the assumptions slightly if your test solution needs additional realism, but keep the domain centered on subscription/billing correctness.

---

## What You Need to Build

Build an automated test solution that validates the Subscription & Billing Service at **multiple layers**, structured as an **object-oriented test framework** — not a flat pile of test-script files.

### Required Validation Depth

#### 1) API Validation
Validate:
- request/response correctness for creation, retrieval, cancellation
- response codes and payload shape
- validation errors (invalid plan, missing fields, unknown customer)
- webhook endpoint request handling (valid/invalid signature, malformed payload)

#### 2) State-Machine / Workflow Validation
Validate:
- every listed lifecycle transition happens correctly given the right trigger
- invalid transitions are rejected or safely ignored (e.g., a `payment.succeeded` webhook for an already-canceled subscription must not reactivate it)
- plan-specific behavior (trial length, price) is applied correctly

#### 3) Database Validation
Validate:
- subscription row reflects current state and plan
- invoice/payment rows are written correctly for each billing attempt
- webhook/payment events are recorded, including duplicates that were correctly no-op'd
- invalid or duplicate side effects are not persisted

Your tests should demonstrate that **persisted state matches both the API-visible outcome and the business rules**, at every point in the lifecycle, not just at creation.

#### 4) External Integration (Mock) Validation
The payment provider is an external dependency. You must **mock it**, not assume it:
- when your service fixture calls out to charge a customer, that call must go through a mockable client interface, verified for call count and arguments
- inbound webhooks must be simulated by your test suite constructing signed (and deliberately unsigned/malformed) payloads and posting them to the webhook endpoint
- you must prove the service behaves correctly whether the mock reports success, decline, or timeout

---

## Required Design Patterns

A strong submission makes deliberate, named use of object-oriented design where it earns its keep. At minimum, your solution (service fixture and/or test framework) should demonstrate:

- **A state-machine representation for the subscription lifecycle** (a State pattern, an explicit transition table, or an equivalent) that makes illegal transitions structurally hard to reach — not a `status` string mutated ad hoc from six different call sites.
- **A Builder** for constructing test data (subscriptions, webhook payloads, customers) so scenarios read as intent, not repeated object literals.
- **An interface/seam around the payment provider** (Strategy, Adapter, or simple dependency injection) so tests can substitute a mock/fake implementation instead of a real network call.
- **One more creational or structural pattern of your choice**, applied where it actually reduces duplication or clarifies intent (e.g. a Factory for building API clients per environment, a Repository for persistence access instead of raw queries scattered through tests).

Naming a pattern in your PR description that isn't actually present in the code is a bigger red flag than not using enough patterns. Use them because they solve a real problem in this codebase, not to check a box.

---

## Functional Expectations

### A) Subscription Creation & Activation
Validate that:
- a subscription is created in the correct initial state per plan config
- the payment provider mock is called with the correct amount/customer/payment method
- persisted records and API response agree

### B) Validation Failures
Cover examples such as:
- unknown plan
- missing/invalid customer or payment method
- canceling an already-canceled subscription

These tests should verify both API response behavior and absence of invalid persistence or provider calls.

### C) Payment Failure Handling
Validate that:
- a failed charge (via mock or webhook) moves the subscription to `past_due`, not `active` or `canceled`
- no invalid success record is created
- the failure is recorded (invoice/payment event)

### D) Webhook Idempotency / Duplicate Delivery
This is mandatory.

Validate scenarios such as:
- the same `event_id` delivered twice results in the transition happening exactly once
- a duplicate webhook does not create a duplicate invoice/payment row
- a duplicate webhook does not fire any side effect (e.g. notification) more than once, if your fixture models one

### E) State-Machine Invariants
This is mandatory.

Validate scenarios such as:
- every valid transition in the lifecycle diagram is exercised by at least one test
- at least two invalid transitions are proven impossible (e.g. `canceled` → `active` via a stray webhook)
- a `payment.failed` webhook arriving *after* a `payment.succeeded` webhook for the same invoice does not regress an already-active subscription

### F) Mocked Payment Provider Interaction
Validate that:
- the provider client is called exactly once per real billing attempt
- the provider client is **not** called for actions that don't require a charge (e.g. rejected creation, replayed webhook)
- your tests assert on what was passed to the mock (amount, customer, idempotency/reference), not just that "something was called"

### G) Persistence and Auditability
Validate that:
- subscription, invoice, and event records match the API-visible result at every stage
- timestamps/statuses/references are internally coherent
- no contradictory records exist (e.g. an `active` subscription with only a `failed` invoice on record)

---

## System Under Test Assumptions

You may choose one of the following approaches and document it clearly.

### Option 1 — Test an Existing Service
If a service implementation is provided, write automation around it.

### Option 2 — Build a Minimal Service Fixture
If no service is provided, create a minimal subscription/billing implementation or test harness sufficient to demonstrate your test strategy. TypeScript/Node.js is expected; an in-memory or embedded persistence layer is fine as long as it's queryable in tests.

### Option 3 — Hybrid
Create a lightweight service plus test doubles for surrounding dependencies (in particular, the payment provider).

All options are acceptable, provided the assignment remains focused on **test engineering and design quality** rather than on building a full product.

---

## Architecture Expectations for the Test Solution

We expect a clean, maintainable, object-oriented automation structure.

A strong submission will usually make the following distinctions clear, typically as separate classes/modules:

### 1) Test Fixtures / Environment Setup
Responsibilities:
- seed customers, plans, and subscriptions
- prepare persistence state
- construct and inject the mock payment provider
- isolate test runs

### 2) API Client Layer
Responsibilities:
- encapsulate HTTP calls behind a typed client class
- keep transport details out of test logic
- support reusable request construction

### 3) Mock Payment Provider / Webhook Simulator
Responsibilities:
- implement the payment provider interface as a test double with configurable outcomes (success/decline/timeout)
- record calls for later assertion (arguments, call count)
- construct valid and invalid signed webhook payloads

### 4) Assertion / Verification Layer
Responsibilities:
- validate API responses
- validate persisted state via a repository/DAO, not raw queries inline in tests
- validate mock provider interactions
- express business/state-machine expectations clearly

### 5) Test Scenarios / Specifications
Responsibilities:
- describe behavior readably
- group related scenarios (lifecycle, webhooks, validation, provider interaction)
- make failure intent obvious

### 6) Test Data Builders
Responsibilities:
- construct subscriptions, customers, webhook payloads
- avoid repetitive setup noise
- keep tests easy to read

The exact structure is your choice, but the suite should be easy to reason about, extend, and should visibly reflect the design patterns you chose above.

---

## Documentation-First Workflow

Before writing substantial automation code, document the intended validation strategy.

At minimum, include:

- assumptions about the system under test
- scope of automation
- test levels covered
- what is real vs. mocked/stubbed, and why
- the design patterns you applied and where
- API contracts
- database entities checked
- webhook/idempotency strategy
- known limitations

We are intentionally looking for candidates who can define a **test strategy and framework design for a stateful, integration-heavy system** before writing large amounts of code.

---

## Required Database Coverage

Your test suite must validate persistence, not just API responses.

At minimum, assume the following persisted entities exist and validate those relevant to your design:

- `subscriptions`
- `invoices` or `payments`
- `webhook_events` (or equivalent, tracking processed event IDs for idempotency)
- an audit/event log per subscription, if modeled separately from the above

Document:

- which entities are checked
- which invariants are asserted
- how test data is seeded and cleaned
- how you avoid false positives from stale data

---

## Required Invariants to Validate

A strong solution will validate explicit invariants such as:

- a subscription never reaches `active` without at least one successful, persisted payment record
- a subscription in `canceled` never transitions again, regardless of subsequent webhooks
- duplicate webhook delivery never produces duplicate invoices, payments, or provider charges
- the payment provider mock is called at most once per genuine billing attempt
- persisted subscription state always matches the externally observed API result
- plan price/trial rules are applied consistently between creation and billing

You may define additional invariants if helpful.

---

## Reliability and Failure Expectations

Your test strategy should explicitly account for the following classes of problems:

- duplicate/redelivered webhooks
- out-of-order webhook delivery
- payment provider timeouts and declines
- invalid or forged webhook signatures
- invalid state transitions
- persistence mismatches between subscription and invoice records

Concurrent/racing webhook delivery (e.g. two webhooks for the same subscription processed in parallel) is a **bonus**, not mandatory — cover it if time allows, but don't sacrifice the mandatory categories above to get to it.

---

## Testing Requirements

We expect meaningful, well-structured automation, not just endpoint smoke tests.

### Required Testing Categories

#### 1) API Contract and Validation Tests
Cover success responses, validation failures, and webhook request handling (valid/invalid signature, malformed payload).

#### 2) State-Machine Tests
Cover every valid transition and at least two invalid ones, driven by both API calls and webhooks.

#### 3) Database Verification Tests
Cover subscription/invoice/webhook-event persistence and absence of duplicate side effects.

#### 4) Mock Provider / Webhook Interaction Tests
Cover call count, call arguments, and behavior under mocked success/decline/timeout.

#### 5) End-to-End Flow Tests
Cover the path from API request or webhook delivery, through service processing, to persistence and provider interaction.

### Red, Blue, Green Discipline

Please follow a **Red, Blue, Green** workflow:

- **Red**: write a failing automated test for an important behavior or invariant
- **Blue**: implement the minimum necessary support code or fixture to make it pass
- **Green**: refactor for readability, reusability, and maintainability while keeping tests green

You do not need to submit every intermediate step, but your approach should reflect disciplined test-first or behavior-first thinking.

---

## Technology Choices

TypeScript is expected; plain JavaScript is acceptable if you have a strong reason. Suggested stack:

- **Test runner**: Jest or Vitest
- **HTTP testing**: Supertest (if you build an HTTP fixture)
- **Mocking**: built-in `jest.fn()`/`vi.fn()` for the payment provider interface; `nock` or `msw` if your fixture makes real outbound HTTP calls you need to intercept
- **Persistence**: an in-memory store, `better-sqlite3`, or any embedded database — pick whatever keeps setup friction low

Please prefer a stack that makes your test logic, class structure, and verification strategy easy to understand. If you make simplifying assumptions, document them.

---

## Non-Goals

You do **not** need to build:

- a frontend UI
- a real payment provider integration
- exhaustive performance testing
- a full production monitoring setup
- elaborate test-report dashboards
- every possible billing feature (proration edge cases, multi-currency, taxes, etc.)

Keep the scope tight. Depth is more important than breadth.

---

## Deliverables

Please submit your solution as a **Pull Request**.

Your PR should include:

- automation test code
- any minimal service fixture or test harness needed
- persistence setup/seed instructions
- documentation on how to run the tests
- a short design/test strategy explanation, including which design patterns you used and why
- assumptions, tradeoffs, and limitations

### PR Description Requirements

Your PR description must explicitly explain:

1. **Test strategy**
   - what levels are covered
   - what is in scope vs out of scope
   - what is real vs stubbed/mocked

2. **OOP and design pattern choices**
   - which patterns you used, where, and why
   - what problem each one actually solved in your codebase

3. **API validation approach**
   - how requests/responses and webhook handling are validated

4. **Database validation approach**
   - which entities are checked
   - what invariants are asserted
   - how data correctness is confirmed

5. **Mock payment provider / webhook validation**
   - how the provider interface is mocked
   - how idempotent/duplicate webhook handling is proven
   - what confidence these tests provide

6. **Test architecture**
   - how the suite is structured
   - why it is maintainable

7. **Responsible AI usage**
   - whether you used AI tools
   - where they helped
   - what you personally reviewed, validated, or corrected

Please be candid. AI usage is allowed, but we care about test engineering judgment, not generated volume.

---

## What We Are Optimizing For

A strong submission is one that:

- expresses the subscription lifecycle as real, structurally-enforced state — not a string field mutated from everywhere
- applies design patterns because they solve a concrete problem in this codebase, and can explain why
- proves important invariants — persisted state, provider-call correctness, idempotency — not just status codes
- mocks the external payment provider cleanly and verifies interactions meaningfully
- is easy to reason about and maintain
- documents assumptions and tradeoffs clearly

A smaller but robust, well-designed automation solution is preferred over a broad but superficial one

