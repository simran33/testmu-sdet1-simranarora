# testmu-sdet1-simranarora

Playwright + TypeScript test suite for **Practice Software Testing**, a demo tool shop:

- Web app: https://practicesoftwaretesting.com
- REST API: https://api.practicesoftwaretesting.com (Swagger: `/api/documentation`)

It covers three modules from the approved test cases in `test-cases/test-cases.xlsx`:

| Module | Spec file | Test IDs |
|---|---|---|
| Login | `tests/ui/login.spec.ts` | `TC_LOGIN_001` – `TC_LOGIN_022` |
| Dashboard | `tests/ui/dashboard.spec.ts` | `TC_DASHBOARD_023` – `TC_DASHBOARD_045` |
| REST API | `tests/api/api.spec.ts` | `TC_API_046` – `TC_API_070` |

Only rows marked **Approved** in the sheet are automated. Every test title starts with its ID, e.g. `TC_LOGIN_001 | Customer logs in with valid email and password`.

When a test fails, an optional **AI Failure Explainer** (DeepSeek or Gemini) adds a plain-English explanation and a suggested fix to the HTML report.

---

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | **20.12 or newer** (the config uses `process.loadEnvFile`) | `node -v` |
| npm | comes with Node | `npm -v` |
| Git | any recent version | `git --version` |

Install Node from https://nodejs.org (LTS) or with `nvm install --lts`.

## 2. Install

```bash
git clone https://github.com/simran33/testmu-sdet1-simranarora.git
cd testmu-sdet1-simranarora
npm ci
npx playwright install --with-deps chromium
```

The suite runs on **Chromium only**, so no other browsers are needed.

## 3. Create the `.env` file

All URLs, logins and API keys come from `.env`. It is git-ignored, so every machine needs its own copy.

```bash
cp .env.example .env
```

Then fill in the empty values as described below.

### 3.1 Site URLs and demo logins (required)

```dotenv
BASE_URL=https://practicesoftwaretesting.com
API_URL=https://api.practicesoftwaretesting.com
CUSTOMER_EMAIL=customer@practicesoftwaretesting.com
CUSTOMER_PASSWORD=welcome01
ADMIN_EMAIL=admin@practicesoftwaretesting.com
ADMIN_PASSWORD=welcome01
```

These are the site's **public demo accounts**. They are listed in the site's GitHub README, so you do not need to register anything. Check the current values there if login fails:
https://github.com/testsmith-io/practice-software-testing#readme

The tests use these shared accounts only for successful logins and read-only checks. Anything that changes an account (lockout, password reset, orders, failed logins) uses a **new user that the tests register on the fly**, so you never need to create test users by hand.

### 3.2 AI Failure Explainer (optional)

Pick one provider with `LLM_PROVIDER` and fill in that provider's key. If the key is empty, the tests still run normally; the report just says "AI analysis not available: no API key".

```dotenv
LLM_PROVIDER=gemini          # deepseek or gemini

DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash

GEMINI_API_KEY=
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_MODEL=gemini-3.5-flash-lite
```

**Get a Gemini key (has a free tier):**

1. Open https://aistudio.google.com/apikey and sign in with a Google account.
2. Click **Create API key** and copy it.
3. Paste it into `GEMINI_API_KEY` and set `LLM_PROVIDER=gemini`.

The free tier has a small **daily request limit per model** (for example, 20 requests a day). If the report says "quota or rate limit reached (429)", wait until it resets, switch `GEMINI_MODEL` to another model (each has its own quota), or enable billing. Model list: https://ai.google.dev/gemini-api/docs/models

**Get a DeepSeek key (paid, prepaid balance):**

1. Open https://platform.deepseek.com and sign up.
2. Go to **API keys**, create a key and copy it.
3. **Top up** the account balance; a key with zero balance returns "no balance (402)".
4. Paste it into `DEEPSEEK_API_KEY` and set `LLM_PROVIDER=deepseek`.

Docs: https://api-docs.deepseek.com/

> **Keep each key in its own variable.** The explainer sends `DEEPSEEK_API_KEY` to DeepSeek and `GEMINI_API_KEY` to Google. A key from another company (for example an OpenAI key) does not work in these variables, and it would be sent to the wrong company. If that happens, revoke the key.

### 3.3 Rate-limit tests (optional, test environment only)

`TC_API_063` – `TC_API_065` send bursts of requests. The approved test cases say to run them only against a test environment, so they are **skipped by default**. To run them:

```dotenv
RATE_LIMIT_TESTS=true
RATE_LIMIT_MAX_REQUESTS=150
```

## 4. Run the tests

```bash
# Everything
npx playwright test

# One module
npx playwright test tests/ui/login.spec.ts
npx playwright test tests/ui/dashboard.spec.ts
npx playwright test tests/api

# One test case by ID (the space after the ID avoids matching TC_LOGIN_0010 etc.)
npx playwright test -g "TC_LOGIN_001 "

# Watch it in a browser
npx playwright test -g "TC_LOGIN_001 " --headed
```

Then open the HTML report:

```bash
npx playwright show-report
```

**Run time:** about 6–7 minutes for the full suite. Three tests wait for the server's real 5-minute token expiry: `TC_LOGIN_015`, `TC_LOGIN_018` and `TC_API_050`. To skip them while developing:

```bash
npx playwright test --grep-invert "TC_LOGIN_015 |TC_LOGIN_018 |TC_API_050 "
```

## 5. AI failure analysis in the report

For each test that **really fails** (not skipped, not an expected failure), an automatic fixture in `tests/fixtures.ts`:

1. Collects the evidence:
   - UI tests: error, test code, page URL, accessibility snapshot of the page.
   - API tests: error, test code, the last API responses (status and body).
2. Removes secrets (JWTs, bearer tokens, passwords, API keys).
3. Fills the prompt template `prompts/failure-explanation.md` and calls the configured LLM.
4. Attaches the result to the test as **"AI failure analysis"**, with a one-line summary shown at the top of the test in the report.

Safety rules:

- At most **10 AI calls per run** (shared across all workers). Later failures say the limit was reached.
- The analysis **never changes a test result**. No key, no balance, quota used up or provider down: the report says so in plain words and the test keeps its real status.
- If the AI decides the failure is an application bug, it is told not to suggest changing the test.

Code: `utils/llm-client.ts` (provider call), `utils/failure-explainer.ts` (prompt, redaction, call limit, answer parsing).

### 5.1 Why Option A (Failure Explainer) and not Option B (Flaky Test Classifier), for now

- **It targets the ticket's problem.** The ticket is about time spent writing and *fixing* regression tests. Option A helps from the very first failure: it says what broke, whether the test or the app is at fault, and what to do next.
- **It works where the team already looks.** The answer is attached to the failed test in the Playwright HTML report, with no extra tool or page.
- **Option B needs history we don't have yet.** Telling "flaky" from "real bug" takes results from many runs. Without that history, its answers would mostly be guesses.
- **Option A already answers Option B's main question per failure.** Each analysis gives a verdict: real app bug, test problem, or environment issue.

Later, once results from many runs are kept, Option B can be added on top, using this explainer's verdicts plus the run history.

## 6. Project structure

```
pages/                    Page objects and the API client (all locators live here)
  login.ts                Login and Forgot password pages
  dashboard.ts            Header, My account, invoices, profile, admin dashboard
  admin-users.ts          Admin > Users list and Edit user
  admin-lists.ts          Admin > Orders and Products lists
  api.ts                  REST API client
tests/
  fixtures.ts             test/expect with the AI Failure Explainer fixture
  ui/                     UI specs (login, dashboard)
  api/                    API specs
utils/                    Config and helpers
  env.ts                  Reads .env
  test-user.ts            Registers fresh users, locks accounts
  test-data.ts            API login for UI tests, orders, brands
  schema.ts               Field/type checks for API responses
  email-generator.ts, name-generator.ts
  llm-client.ts, failure-explainer.ts
prompts/
  failure-explanation.md  Prompt template for the AI Failure Explainer
test-cases/
  test-cases.xlsx         Manual test cases with review status
playwright.config.ts      Chromium only, baseURL from .env, data-test locators
```

Locators use the site's `data-test` attributes (`getByTestId`). A few elements have no `data-test`; those use roles or labels and are commented in the page objects.

## 7. Rules for working on this suite

- **Never call `POST /refresh`** on the API. It resets the shared demo database. (`GET /users/refresh` is the normal token refresh and is fine.)
- **Do not lock or change the shared demo accounts.** Use `createTestUser()` from `utils/test-user.ts` for anything that changes account state.
- **No hard waits** (`waitForTimeout`). Wait for a response, a locator or an `expect.poll` condition instead.
- **Each test runs on its own.** No test depends on another test's data.
- **If a test fails because the app is wrong, do not change the expected result.** The expected results come from approved test cases.
- Remove any `test.only` before pushing. CI fails on `.only` (`forbidOnly`).

## 8. Known failures

The site is a practice app with planted bugs, so some tests fail by design. As of the last full run: **50 passed, 14 failed, 3 skipped**.

| Test | Reason |
|---|---|
| `TC_LOGIN_012` | Reset success banner shows the raw text key `page.forgot-password.confirm` |
| `TC_LOGIN_013` | Reset form reveals whether an email is registered |
| `TC_LOGIN_014` | Malformed email shows an empty error box |
| `TC_LOGIN_015` | Session does not end when the token expires (the app refreshes the expired token) |
| `TC_DASHBOARD_024` | Dashboard took over 3 s to load (depends on the network) |
| `TC_DASHBOARD_025` | No loading indicator on a slow network |
| `TC_DASHBOARD_026` | No error message when chart data fails to load |
| `TC_DASHBOARD_029` | Yearly sales total does not change right after a new order |
| `TC_DASHBOARD_033` | Admin Products list has no sorting |
| `TC_DASHBOARD_034` | No "no results" message for an empty search |
| `TC_DASHBOARD_035` | Search filter is lost on page 2 |
| `TC_DASHBOARD_037` | Latest orders table overflows on mobile |
| `TC_API_056` | `POST /brands` works with a customer token or no token |
| `TC_API_067` | `product.brand` has no `slug`, unlike the API docs |

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `Missing environment variable BASE_URL. Add it to .env` | Create `.env` from `.env.example` (step 3). |
| `process.loadEnvFile is not a function` | Upgrade Node to 20.12 or newer. |
| `Executable doesn't exist ... chromium` | Run `npx playwright install --with-deps chromium`. |
| Demo login fails for every test | The demo passwords may have changed; check the site's GitHub README (step 3.1). |
| Only a few tests run | A `test.only` is left in a spec file; remove it. |
| Report says "AI analysis not available: ..." | Read the reason: missing key, no balance (402), quota reached (429), unknown model (404) or provider down. Fix `.env` and run again. |
| A test times out only in the full run | The public demo site can be slow under parallel load; re-run that test alone to confirm. |

## 10. Future enhancements

### 10.1 "Fix with AI" button: from explanation to pull request

Today the Failure Explainer only **explains** a failure. The next step is a **"Fix with AI"** button next to each "AI failure analysis" in the report. When someone clicks it, an LLM agent would:

1. Get read access to the repository and the failure evidence (error, test code, page snapshot or API responses, and the explainer's verdict).
2. Investigate and decide the cause: test bug, app bug, or environment issue.
3. Act on that verdict:
   - **Test bug** (wrong locator, wrong wait, outdated page object): change the test code on a new branch, run the affected tests, and open a **pull request** that explains the cause and the fix.
   - **App bug**: do not touch the test. Instead, draft a bug report (steps, expected vs actual, evidence) for the team to file.
   - **Environment issue**: report it and suggest a re-run; no code change.
4. Link the pull request or bug draft back to the failed test in the report.

Guardrails this feature must keep:

- **A human always decides.** The agent only opens a pull request; it never merges or pushes to `main`, and every PR needs a normal code review.
- **Expected results are never changed to make a test pass.** They come from approved test cases; if the app is wrong, the test stays failing.
- **Limited access.** A token scoped to this repository, branch-and-PR permissions only, no access to secrets beyond what the run needs.
- **Proof before the PR.** The agent re-runs the changed tests and attaches the results; a PR whose tests still fail is marked as a draft.
- **Same safety rules as today:** a per-run call limit, secret redaction before anything is sent, and the suite's rules from section 7 (no `POST /refresh`, no changes to shared demo accounts, no hard waits).

