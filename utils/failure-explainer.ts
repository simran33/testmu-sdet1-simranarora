import fs from 'fs';
import path from 'path';
import { chatCompletion, LlmError, resolveLlmConfig } from './llm-client';

const TEMPLATE_PATH = path.resolve(__dirname, '..', 'prompts', 'failure-explanation.md');

/** Hard cap on LLM calls per test run, shared by all workers. */
export const MAX_AI_CALLS_PER_RUN = Math.min(Number(process.env.AI_MAX_CALLS_PER_RUN ?? 10) || 10, 10);

const LIMITS = { error: 4_000, testCode: 6_000, evidence: 12_000, responseBody: 2_000 };

export type Verdict = 'app_bug' | 'test_bug' | 'environment' | 'unclear';

export interface RecordedApiCall {
  method: string;
  url: string;
  status: number;
  body: string;
}

export interface FailureInput {
  title: string;
  file: string;
  line: number;
  /** "UI" when the test used the page fixture, otherwise "API". */
  type: 'UI' | 'API';
  errors: string[];
  url?: string;
  ariaSnapshot?: string;
  apiCalls: RecordedApiCall[];
}

export interface FailureReport {
  /** One line, shown at the top of the test in the HTML report. */
  summary: string;
  /** Full text attached to the test as "AI failure analysis". */
  body: string;
}

const VERDICT_LABELS: Record<Verdict, string> = {
  app_bug: 'Application bug',
  test_bug: 'Test code problem',
  environment: 'Environment / test data problem',
  unclear: 'Unclear from the evidence',
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated, ${text.length - max} more characters)`;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Removes secrets before anything leaves the machine: JWTs, bearer tokens, password fields,
 * the passwords from .env and the generated test-user passwords.
 */
export function redactSecrets(text: string): string {
  const knownSecrets = ['CUSTOMER_PASSWORD', 'ADMIN_PASSWORD', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY']
    .map((name) => process.env[name])
    .filter((value): value is string => !!value && value.length >= 4);
  let result = text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1[REDACTED]')
    .replace(/("(?:password|access_token|token|api_key)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/Qa![a-z0-9]{6}A9x/g, '[REDACTED_PASSWORD]');
  for (const secret of knownSecrets) result = result.split(secret).join('[REDACTED]');
  return result;
}

/** Replaces {{name}} placeholders in one pass, so placeholder-like text inside values is left alone. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

/** Returns the source of the test that starts at `line`, by matching braces from the `test(` call. */
export function extractTestCode(file: string, line: number): string {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const start = Math.max(0, line - 1);
    let depth = 0;
    let opened = false;
    for (let i = start; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          depth++;
          opened = true;
        } else if (char === '}') {
          depth--;
        }
      }
      if (opened && depth <= 0) return lines.slice(start, i + 1).join('\n');
    }
    return lines.slice(start, start + 80).join('\n');
  } catch {
    return '(test source not available)';
  }
}

function buildEvidence(input: FailureInput): string {
  if (input.type === 'UI') {
    return input.ariaSnapshot
      ? `Accessibility snapshot of the page when the test failed (YAML):\n\n\`\`\`yaml\n${input.ariaSnapshot}\n\`\`\``
      : 'No page snapshot could be captured.';
  }
  if (!input.apiCalls.length) return 'No API response was recorded.';
  const calls = input.apiCalls.map(
    (call, i) =>
      `${i + 1}. ${call.method} ${call.url}\n   Status: ${call.status}\n   Body: ${truncate(call.body, LIMITS.responseBody)}`,
  );
  return `Last API responses before the failure (most recent last):\n\n${calls.join('\n\n')}`;
}

/** Builds the prompt from prompts/failure-explanation.md, read from disk at runtime. */
export function buildPrompt(input: FailureInput): string {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const values: Record<string, string> = {
    test_title: input.title,
    test_type: input.type,
    test_file: `${path.relative(process.cwd(), input.file)}:${input.line}`,
    error: truncate(stripAnsi(input.errors.join('\n\n')) || '(no error message)', LIMITS.error),
    test_code: truncate(extractTestCode(input.file, input.line), LIMITS.testCode),
    url: input.type === 'UI' ? input.url || '(unknown)' : '(not a UI test)',
    evidence: truncate(buildEvidence(input), LIMITS.evidence),
  };
  for (const key of Object.keys(values)) values[key] = redactSecrets(values[key]);
  return fillTemplate(template, values);
}

interface ParsedAnswer {
  summary: string;
  verdict: Verdict;
  what_broke: string;
  suggested_fix: string;
}

/** Reads the model's JSON answer; tolerates code fences and missing fields. */
export function parseAnswer(text: string): ParsedAnswer {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(cleaned);
  } catch {
    return { summary: cleaned.split('\n')[0].slice(0, 200), verdict: 'unclear', what_broke: cleaned, suggested_fix: '' };
  }
  const field = (key: string) => (typeof data[key] === 'string' ? (data[key] as string).trim() : '');
  const verdict = field('verdict') as Verdict;
  return {
    summary: field('summary') || 'The AI did not give a summary.',
    verdict: verdict in VERDICT_LABELS ? verdict : 'unclear',
    what_broke: field('what_broke'),
    suggested_fix: field('suggested_fix'),
  };
}

function formatReport(answer: ParsedAnswer, generatedBy: string): FailureReport {
  const summary = `${VERDICT_LABELS[answer.verdict]}: ${answer.summary}`;
  const body = [
    `Summary: ${summary}`,
    '',
    `Verdict: ${VERDICT_LABELS[answer.verdict]}`,
    '',
    'What broke:',
    answer.what_broke || '(not given)',
    '',
    'Suggested fix:',
    answer.suggested_fix || '(not given)',
    '',
    `Generated by ${generatedBy}. AI output: check it before acting on it. The test result is not changed by this analysis.`,
  ].join('\n');
  return { summary, body };
}

/** Report used when no AI analysis could be produced. */
export function unavailableReport(reason: string): FailureReport {
  const summary = `AI analysis not available: ${reason}`;
  return { summary, body: `Summary: ${summary}\n\nThe test result is not affected.` };
}

/**
 * Claims one of the per-run AI call slots. Slots are files created with the exclusive "wx" flag,
 * so parallel workers can never use more than MAX_AI_CALLS_PER_RUN in total.
 */
function claimCallSlot(budgetDir: string, owner: string): boolean {
  fs.mkdirSync(budgetDir, { recursive: true });
  for (let slot = 1; slot <= MAX_AI_CALLS_PER_RUN; slot++) {
    try {
      fs.writeFileSync(path.join(budgetDir, `slot-${slot}`), owner, { flag: 'wx' });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  return false;
}

/**
 * Asks the configured LLM (LLM_PROVIDER in .env) to explain one failed test.
 * Never throws: every problem becomes a readable report.
 */
export async function explainFailure(input: FailureInput, budgetDir: string): Promise<FailureReport> {
  try {
    const resolved = resolveLlmConfig();
    if ('problem' in resolved) return unavailableReport(resolved.problem);
    const { config } = resolved;
    if (!claimCallSlot(budgetDir, input.title)) {
      return unavailableReport(
        `the limit of ${MAX_AI_CALLS_PER_RUN} AI calls per run was reached, so this failure was not sent to ${config.label}.`,
      );
    }
    const answer = await chatCompletion(config, buildPrompt(input), { json: true, maxTokens: 2000 });
    return formatReport(parseAnswer(answer), `${config.label} (${config.model})`);
  } catch (error) {
    const reason = error instanceof LlmError ? error.message : `unexpected error (${(error as Error)?.message ?? error})`;
    return unavailableReport(reason);
  }
}
