create a folder structure as per this format
- tests/
 	- ui/
	- api/
- pages/
	- login.ts
	- dashboard.ts
	- api.ts
- utils/
	- email-generator.ts
	- name-generator.ts
	- ….
- test-cases/
	- test-cases.xlsx
	- test-case.json
- test-data/
       - data.json
- prompts/    
        -  failure-explanation.md
- scripts
- prompts.md
- .env

######
You are a manual QA expert. Your job is to write test cases for the website Practice Software Testing (https://practicesoftwaretesting.com), a demo online tool shop. Its REST API is at https://api.practicesoftwaretesting.com.

Cover these modules:
- Login: valid login, invalid credentials, forgot password, session expiry, brute-force lockout.
- Dashboard: widget loading, data accuracy, filter/sort behavior, responsive layout, permission-based visibility.
- REST API: auth token validation, CRUD operations, error handling (4xx/5xx), rate limiting, schema validation.

Write all the test cases in plain English, in a table  test-cases/test-cases.xlsx. I will review and approve each one manually.

If you need any additional information, ask me before writing the test cases.

Claude Asked :
Question1:Dashboard: Which screen should ‘Dashboard’ cover? The site has an admin dashboard (/admin/dashboard, with sales report widgets) and a customer ‘My account’ page.

❯ 1. Admin + customer (Recommended)
     Admin dashboard widgets, data, filters and layout. Customer/guest role used to test permission-based visibility.
  2. Admin dashboard only
     Only /admin/dashboard and its report widgets.
  3. Customer My account only
     Only the logged-in customer's account page.
  4. Type something.
 Replied : 1  Admin + customer (Recommended)
 
#####
Claude Asked :
 Question2 :· How many test cases per module topic (e.g. 'valid login', 'CRUD operations')? → ~4-5 each, ~70 total (Recommended)

❯ 1. ~4-5 each, ~70 total (Recommended)
     Positive, negative and edge cases per topic. Manageable to review one by one.
  2. ~2-3 each, ~40 total
     Core paths only. Quicker review.
  3. ~8+ each, 120+ total
     Exhaustive, including boundary and rare edge cases.
  4. Type something.
   Replied : 1   ~4-5 each, ~70 total (Recommended)
##### 
Claude Asked :
 Question3 :
│ Which columns should the sheet have? It currently has: ID, Title, Preconditions, Steps, Expected Result, Priority, Status.
❯ 1. Extended + review cols (Recommended)
     ID, Module, Sub-module, Title, Type (Positive/Negative/Edge), Preconditions, Test Data, Steps, Expected Result, Priority, Review Status (Pending/Approved/Rejected), Reviewer Comments.
  2. Keep current columns
     Use the 7 existing columns exactly.
  3. Type something.
     Replied : 1 Extended + review cols (Recommended)

  Submit Answers

######
  I've approved the test cases in test-cases/test-cases.xlsx. Please automate them with Playwright and TypeScript.

Only pick rows marked "Approved" or "Modified" (for modified ones, follow my Reviewer Comments). Let's start with Login and stop there so I can review before Dashboard and the API.

Keep locators in page objects under pages/, UI tests in tests/ui/, API tests in tests/api/, and config/helpers in utils/ (read URLs and logins from .env). Start each test title with its test case ID, like "TC_LOGIN_001 | Valid login".

A few rules:
- Use real locators from https://practicesoftwaretesting.com (prefer data-test attributes). Don't guess.
- No hard waits. Each test should run on its own.
- Don't lock or change the shared demo accounts. Register a fresh user for lockout and forgot password.
- Never call POST /refresh. It resets the demo database.

Run the tests and fix any mistakes in the test code. If a test fails because the app is wrong, don't change the expected result. Leave it failing and tell me why.

When you're done, give me a short table: test case ID, test name, pass/fail and why. Don't commit anything. I'll review it first.


#####
 After this move on to Dashboard and the API.

 #####
 The test cases are set up and running fine. Now I'd like to add Option A, a Failure Explainer, to the HTML report, so it clearly explains every failure.

What it should do:
- When a test fails, send the failure details to the DeepSeek API (a real call, not mocked)
- Get back a plain-English explanation of what broke and a suggested fix
- Attach it to that test in the Playwright HTML report as "AI failure analysis", with a one-line summary at the top

What to send:
- UI tests: the error, the failing test's code, the page URL and the page state (accessibility snapshot)
- API tests: the error and the API response (status and body)

Where things go (please follow my existing folder structure):
- Prompt template: prompts/failure-explanation.md (placeholders like {{error}}, {{test_code}}, {{url}}, {{evidence}}), loaded by the code at runtime, not hard-coded
- LLM code: utils/llm-client.ts (the DeepSeek call) and utils/failure-explainer.ts (builds the prompt, reads the answer)
- Fixture: tests/fixtures.ts, and the tests import test/expect from there
- DeepSeek key from .env as DEEPSEEK_API_KEY (add it to .env.example, empty)
- DeepSeek's API is OpenAI-compatible; check their docs for the base URL and current model name, and read the model from .env too
- If it's a real app bug, the AI should not suggest changing the test
- Don't create new top-level folders

Keep it safe:
- Use an automatic Playwright fixture, so the tests themselves don't change
- Max 10 AI calls per run, only for tests that really failed
- No key, no balance, or DeepSeek down: the report says so in plain words, and the test result never changes

#####
 Make it configurable to switch between gemini and deepseek

#####
❯ Generate a readme file , for setup in a new system including env creds generation as well