# Sdet Assignment by Suraj Soni

## Subscription & Billing Service — SDET Assignment

JavaScript + Playwright API testing solution for the uploaded assignment. It includes a minimal Express service fixture, deterministic mock payment provider, in-memory repository, HMAC-signed webhook simulator, builders, API client wrapper, persistence verifier, tests, and strategy documentation.

## Requirements

- Node.js
- npm

## Setup and run

```bash
npm install
npx playwright install
npm test
```

The Playwright configuration starts the fixture automatically on `http://127.0.0.1:4177`. The suite uses one worker because it resets shared in-memory state between tests.

Optional:
```bash
npm start
# in another terminal:
npm test
```

HTML report:
```bash
npm run test:report
```

## Project structure

```text
subscription-billing-sdet/
├── docs/
│   └── TEST-STRATEGY.md
├── src/
│   ├── app.js
│   ├── builders.js
│   ├── domain.js
│   ├── payment-provider.js
│   ├── repository.js
│   └── server.js
├── tests/
│   ├── support/
│   │   ├── api-client.js
│   │   └── verifiers.js
│   ├── subscription-api.spec.js
│   └── webhook-lifecycle.spec.js
├── package.json
└── playwright.config.js
```

## Test coverage

- Subscription creation, retrieval, cancellation and invalid requests
- Basic trial and Pro immediate-charge behavior
- Mock provider success, decline, timeout; call count and exact arguments
- All valid lifecycle transitions in the assignment
- Canceled subscription terminal-state behavior
- Signed, unsigned, forged, malformed and invalid webhook payloads
- Duplicate event delivery and out-of-order success/failure
- Subscription, invoice, webhook event and audit persistence checks
- Refund record behavior

## Important notes

This is a **demonstration fixture**, not a production billing system. The repository is in memory, so data is not durable. Test-only endpoints under `/__test` control the fake provider and inspect fixture state; they must not be exposed in production. The encoded assumptions, tradeoffs, and hardening recommendations are documented in `docs/TEST-STRATEGY.md`.

## Design patterns

- State machine / transition table: lifecycle transition enforcement
- Builder: test payload construction
- Adapter + dependency injection: mock payment provider
- Repository: persistence seam
- API client object and verifier object: reusable HTTP and assertion layers

## Dummy feature

This section is a placeholder for the dummy feature branch.

## Responsible AI usage

AI assistance was used to draft or review parts of this submission, disclose that in the PR description. Before submitting, personally install dependencies, run the suite, inspect failures, review the business assumptions, and explain the patterns and limitations in your own words. Do not claim tests passed unless you ran them successfully.#
