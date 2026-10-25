import path from 'path';
import { test as base, type APIRequestContext, type APIResponse, type TestInfo } from '@playwright/test';
import { explainFailure, type RecordedApiCall } from '../utils/failure-explainer';

export { expect } from '@playwright/test';

/** Extra time given to the test while the LLM answers, so the analysis can never cause a timeout. */
const ANALYSIS_TIME_MS = 90_000;
const CAPTURE_TIMEOUT_MS = 5_000;
const API_CALLS_KEPT = 5;
const RECORDED_METHODS = new Set(['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head']);

interface FailureEvidence {
  usedPage: boolean;
  url?: string;
  ariaSnapshot?: string;
  responses: { method: string; url: string; response: APIResponse }[];
  apiCalls: RecordedApiCall[];
}

/** True only for a real, unexpected failure (not skipped, not interrupted, not an expected test.fail()). */
function reallyFailed(testInfo: TestInfo): boolean {
  return (
    (testInfo.status === 'failed' || testInfo.status === 'timedOut') &&
    testInfo.status !== testInfo.expectedStatus
  );
}

/** Wraps the request fixture so the last API responses can be shown to the AI when a test fails. */
function recordingRequest(request: APIRequestContext, evidence: FailureEvidence): APIRequestContext {
  return new Proxy(request, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop !== 'string' || !RECORDED_METHODS.has(prop) || typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const response: APIResponse = await value.apply(target, args);
        const options = args[1] as { method?: string } | undefined;
        const method = prop === 'fetch' ? options?.method ?? 'GET' : prop.toUpperCase();
        evidence.responses.push({ method, url: response.url(), response });
        if (evidence.responses.length > API_CALLS_KEPT) evidence.responses.shift();
        return response;
      };
    },
  });
}

/**
 * Failure Explainer: an automatic fixture. When a test really fails, it sends the error, the test code
 * and the evidence (page snapshot for UI tests, API responses for API tests) to the LLM chosen with
 * LLM_PROVIDER in .env (deepseek or gemini) and attaches
 * the explanation to the test as "AI failure analysis". It never changes the test result.
 */
export const test = base.extend<{ failureEvidence: FailureEvidence; aiFailureAnalysis: void }>({
  failureEvidence: async ({}, use) => {
    await use({ usedPage: false, responses: [], apiCalls: [] });
  },

  page: async ({ page, failureEvidence }, use, testInfo) => {
    failureEvidence.usedPage = true;
    await use(page);
    if (!reallyFailed(testInfo)) return;
    try {
      failureEvidence.url = page.url();
      failureEvidence.ariaSnapshot = await page.locator('body').ariaSnapshot({ timeout: CAPTURE_TIMEOUT_MS });
    } catch {
      // Page closed or crashed; the analysis goes ahead without a snapshot.
    }
  },

  request: async ({ request, failureEvidence }, use, testInfo) => {
    await use(recordingRequest(request, failureEvidence));
    if (!reallyFailed(testInfo)) return;
    // Read the bodies now, before the request context is disposed.
    for (const { method, url, response } of failureEvidence.responses) {
      let body: string;
      try {
        body = await response.text();
      } catch {
        body = '(body not available)';
      }
      failureEvidence.apiCalls.push({ method, url, status: response.status(), body });
    }
  },

  aiFailureAnalysis: [
    async ({ failureEvidence }, use, testInfo) => {
      await use();
      if (!reallyFailed(testInfo)) return;
      try {
        testInfo.setTimeout(testInfo.timeout + ANALYSIS_TIME_MS);
        const report = await explainFailure(
          {
            title: testInfo.titlePath.slice(1).join(' › '),
            file: testInfo.file,
            line: testInfo.line,
            type: failureEvidence.usedPage ? 'UI' : 'API',
            errors: testInfo.errors.map((e) => e.stack ?? e.message ?? e.value ?? 'unknown error'),
            url: failureEvidence.url,
            ariaSnapshot: failureEvidence.ariaSnapshot,
            apiCalls: failureEvidence.apiCalls,
          },
          path.join(testInfo.project.outputDir, '.ai-failure-budget', process.env.AI_ANALYSIS_RUN_ID ?? 'default'),
        );
        testInfo.annotations.push({ type: 'AI failure analysis', description: report.summary });
        await testInfo.attach('AI failure analysis', { body: report.body, contentType: 'text/plain' });
      } catch {
        // The explainer must never affect the test result.
      }
    },
    { auto: true },
  ],
});
