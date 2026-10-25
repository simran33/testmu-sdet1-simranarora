import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ApiClient } from '../../pages/api';
import { AdminEditUserPage, AdminUsersPage } from '../../pages/admin-users';
import { AccountPage, AdminDashboardPage, Header } from '../../pages/dashboard';
import { ForgotPasswordPage, LoginPage } from '../../pages/login';
import { env } from '../../utils/env';
import {
  ACCOUNT_LOCKED_MESSAGE,
  MAX_FAILED_LOGINS,
  WRONG_PASSWORD,
  createTestUser,
  lockTestUser,
} from '../../utils/test-user';

const INVALID_LOGIN_MESSAGE = 'Invalid email or password';
const TOKEN_KEY = 'auth-token';

/** Counts requests to an API path so a test can prove the form never sent one. */
function countRequests(page: Page, path: string): () => number {
  let count = 0;
  page.on('request', (r) => {
    if (r.url().endsWith(path)) count++;
  });
  return () => count;
}

async function loginAsCustomer(page: Page): Promise<void> {
  const login = new LoginPage(page);
  await login.goto();
  const response = await login.login(env.customer.email, env.customer.password);
  expect(response.status()).toBe(200);
  await expect(page).toHaveURL(/\/account$/);
}

test.describe('Login', () => {
  test.describe('Valid login', () => {
    test.only('TC_LOGIN_001 | Customer logs in with valid email and password', async ({ page }) => {
      const login = new LoginPage(page);
      const header = new Header(page);
      await login.goto();

      const meResponse = page.waitForResponse(
        (r) => r.request().method() === 'GET' && r.url().endsWith('/users/me') && r.status() === 200,
      );
      const response = await login.login(env.customer.email, env.customer.password);

      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(/\/account$/);
      await expect(new AccountPage(page).pageTitle).toHaveText('My account');
      const me = await (await meResponse).json();
      await expect(header.userMenu).toHaveText(`${me.first_name} ${me.last_name}`);
    });

    test('TC_LOGIN_002 | Admin logs in with valid email and password', async ({ page }) => {
      const login = new LoginPage(page);
      const header = new Header(page);
      await login.goto();

      const meResponse = page.waitForResponse(
        (r) => r.request().method() === 'GET' && r.url().endsWith('/users/me') && r.status() === 200,
      );
      const response = await login.login(env.admin.email, env.admin.password);

      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(/\/admin\/dashboard$/);
      await expect(new AdminDashboardPage(page).pageTitle).toBeVisible();
      const me = await (await meResponse).json();
      await expect(header.userMenu).toHaveText(`${me.first_name} ${me.last_name}`);
    });

    test('TC_LOGIN_003 | Email field is not case-sensitive', async ({ page, request }) => {
      // A fresh user, so a failed attempt can never count against a shared demo account.
      const user = await createTestUser(request);
      const login = new LoginPage(page);
      await login.goto();

      const response = await login.login(user.email.toUpperCase(), user.password);

      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(/\/account$/);
      await expect(new Header(page).userMenu).toBeVisible();
    });

    test('TC_LOGIN_004 | Logged-in session persists after page refresh and across tabs', async ({
      page,
      context,
    }) => {
      const header = new Header(page);
      await loginAsCustomer(page);

      await page.reload();
      await expect(page).toHaveURL(/\/account$/);
      await expect(header.userMenu).toBeVisible();

      const secondTab = await context.newPage();
      const secondAccount = new AccountPage(secondTab);
      await secondAccount.goto();
      await expect(secondTab).toHaveURL(/\/account$/);
      await expect(secondAccount.pageTitle).toHaveText('My account');
      await expect(new Header(secondTab).userMenu).toBeVisible();
    });

    test('TC_LOGIN_005 | User can log out', async ({ page }) => {
      const header = new Header(page);
      await loginAsCustomer(page);

      await header.logout();
      await expect(header.signIn).toBeVisible();

      await new AccountPage(page).goto();
      await expect(page).toHaveURL(/\/auth\/login$/);
    });
  });

  test.describe('Invalid credentials', () => {
    test('TC_LOGIN_006 | Login fails with correct email and wrong password', async ({
      page,
      request,
    }) => {
      // Fresh user instead of the demo customer, so the demo account's failed-login counter is untouched.
      const user = await createTestUser(request);
      const login = new LoginPage(page);
      await login.goto();

      const response = await login.login(user.email, WRONG_PASSWORD);

      expect(response.status()).toBe(401);
      await expect(login.loginError).toHaveText(INVALID_LOGIN_MESSAGE);
      await expect(page).toHaveURL(/\/auth\/login$/);
    });

    test('TC_LOGIN_009 | Login form validates email format', async ({ page }) => {
      const login = new LoginPage(page);
      await login.goto();
      const loginRequests = countRequests(page, '/users/login');

      await login.fill('customer@', env.customer.password);
      await login.submit.click();

      await expect(login.emailError).toHaveText('Email format is invalid');
      expect(loginRequests()).toBe(0);
      await expect(page).toHaveURL(/\/auth\/login$/);
    });

    test('TC_LOGIN_010 | Login is safe against SQL injection in the email field', async ({
      page,
    }) => {
      const login = new LoginPage(page);
      const header = new Header(page);
      await login.goto();

      await login.fill("' OR '1'='1' --", 'anything');
      await login.submit.click();

      await expect(login.emailError.or(login.loginError)).toBeVisible();
      await expect(page).toHaveURL(/\/auth\/login$/);
      await expect(header.signIn).toBeVisible();
      await expect(header.userMenu).toBeHidden();
      await expect(page.locator('body')).not.toContainText(/SQLSTATE|syntax error|exception/i);
    });
  });

  test.describe('Forgot password', () => {
    test('TC_LOGIN_011 | Forgot password link opens the reset page', async ({ page }) => {
      const login = new LoginPage(page);
      const forgot = new ForgotPasswordPage(page);
      await login.goto();

      await login.forgotPasswordLink.click();

      await expect(page).toHaveURL(/\/auth\/forgot-password$/);
      await expect(forgot.email).toBeVisible();
      await expect(forgot.submit).toHaveValue('Set New Password');
    });

    test.only('TC_LOGIN_012 | Password reset request succeeds for a registered email', async ({
      page,
      request,
    }) => {
      // The demo resets the password of this account, so it must be a fresh user.
      const user = await createTestUser(request);
      const forgot = new ForgotPasswordPage(page);
      await forgot.goto();

      const response = await forgot.requestReset(user.email);

      expect(response.status()).toBe(200);
      await expect(forgot.successAlert).toBeVisible();
      await expect(forgot.emailError).toBeHidden();
      // A real confirmation message, not an untranslated i18n key such as "page.x.y".
      // Read once: a retrying `not` assertion would pass as soon as the banner disappears.
      const message = (await forgot.successAlert.textContent())?.trim();
      expect(message).not.toMatch(/^[\w-]+(\.[\w-]+)+$/);
    });

    test.only('TC_LOGIN_013 | Password reset request for an unregistered email does not reveal account existence', async ({
      page,
    }) => {
      const forgot = new ForgotPasswordPage(page);
      await forgot.goto();

      await forgot.requestReset(`not.registered.${Date.now()}@example.com`);

      // The banner disappears after ~3 s, so read it once instead of using a retrying `not` assertion.
      await expect(forgot.resultAlert).toBeVisible();
      const message = await forgot.resultAlert.textContent();
      expect(message).not.toMatch(/email is invalid|not found|does not exist|no account|not registered/i);
      await expect(forgot.successAlert).toBeVisible();
    });

    test.only('TC_LOGIN_014 | Forgot password validates empty and malformed email', async ({ page }) => {
      const forgot = new ForgotPasswordPage(page);
      await forgot.goto();
      const resetRequests = countRequests(page, '/users/forgot-password');

      await forgot.submit.click();
      await expect(forgot.emailError).toHaveText('Email is required');

      await forgot.email.fill('abc');
      await forgot.submit.click();
      await expect(forgot.emailError).toHaveText(/format is invalid/i);

      expect(resetRequests()).toBe(0);
    });
  });

  test.describe('Session expiry', () => {
    test('TC_LOGIN_015 | Session ends when the access token expires', async ({ page, request }) => {
      // The token lives 300 s on the server; this test waits for it to really expire.
      test.setTimeout(10 * 60_000);
      const header = new Header(page);
      // Recorded so a failure report shows whether the app silently refreshed the expired token.
      page.on('response', (r) => {
        if (r.url().endsWith('/users/refresh')) {
          test.info().annotations.push({ type: 'GET /users/refresh', description: String(r.status()) });
        }
      });
      await loginAsCustomer(page);
      const token = await page.evaluate((key) => localStorage.getItem(key), TOKEN_KEY);
      expect(token).toBeTruthy();

      const api = new ApiClient(request);
      await expect
        .poll(async () => (await api.me(token!)).status(), {
          message: 'waiting for the access token to expire on the server',
          timeout: 7 * 60_000,
          intervals: [15_000],
        })
        .toBe(401);

      await header.openUserMenu();
      await header.myInvoices.click();

      await expect(page).toHaveURL(/\/auth\/login$/);
      await expect(header.userMenu).toBeHidden();
    });

    test('TC_LOGIN_016 | Protected page cannot be opened after logout using the Back button', async ({
      page,
    }) => {
      const header = new Header(page);
      const account = new AccountPage(page);
      await loginAsCustomer(page);
      await expect(account.pageTitle).toHaveText('My account');

      await header.logout();
      await expect(header.signIn).toBeVisible();
      await page.goBack();
      await page.reload();

      await expect(page).toHaveURL(/\/auth\/login$/);
      await expect(account.pageTitle.filter({ hasText: 'My account' })).toBeHidden();
      await expect(header.userMenu).toBeHidden();
    });

    test('TC_LOGIN_017 | Session is cleared when the token is removed from browser storage', async ({
      page,
    }) => {
      const header = new Header(page);
      await loginAsCustomer(page);

      await page.evaluate((key) => localStorage.removeItem(key), TOKEN_KEY);
      await page.reload();

      await expect(page).toHaveURL(/\/auth\/login$/);
      await expect(header.userMenu).toBeHidden();
    });

    test('TC_LOGIN_018 | Active session is refreshed while the user is working', async ({ page }) => {
      // Real time is used: a faked browser clock makes the refreshed token look expired too.
      // The user opens a page once a minute until the 300 s token has been refreshed.
      test.setTimeout(10 * 60_000);
      const header = new Header(page);
      const account = new AccountPage(page);
      const refreshes: number[] = [];
      page.on('response', (r) => {
        if (r.url().endsWith('/users/refresh')) refreshes.push(r.status());
      });
      await loginAsCustomer(page);

      let visits = 0;
      await expect
        .poll(
          async () => {
            await header.openUserMenu();
            await (visits++ % 2 === 0 ? header.myInvoices : header.myAccount).click();
            await expect(header.userMenu).toBeVisible();
            return refreshes.length;
          },
          {
            message: 'GET /users/refresh is called while the user keeps working',
            timeout: 7 * 60_000,
            intervals: [60_000],
          },
        )
        .toBeGreaterThan(0);

      expect(refreshes.every((status) => status === 200)).toBe(true);
      await header.openUserMenu();
      await header.myAccount.click();
      await expect(page).toHaveURL(/\/account$/);
      await expect(account.pageTitle).toHaveText('My account');
      await expect(header.signIn).toBeHidden();
    });
  });

  test.describe('Brute-force lockout', () => {
    test('TC_LOGIN_019 | Account is locked after repeated failed logins', async ({ page, request }) => {
      const user = await createTestUser(request);
      const login = new LoginPage(page);
      await login.goto();

      for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt++) {
        const response = await login.login(user.email, WRONG_PASSWORD);
        expect(response.status(), `attempt ${attempt}`).toBe(401);
        await expect(login.loginError).toHaveText(INVALID_LOGIN_MESSAGE);
      }

      const lockedResponse = await login.login(user.email, WRONG_PASSWORD);
      expect(lockedResponse.status()).toBe(423);
      await expect(login.loginError).toHaveText(ACCOUNT_LOCKED_MESSAGE);
    });

    test('TC_LOGIN_020 | Locked account cannot log in even with the correct password', async ({
      page,
      request,
    }) => {
      const user = await createTestUser(request);
      await lockTestUser(request, user);
      const login = new LoginPage(page);
      await login.goto();

      const response = await login.login(user.email, user.password);

      expect(response.status()).toBe(423);
      await expect(login.loginError).toHaveText(ACCOUNT_LOCKED_MESSAGE);
      await expect(page).toHaveURL(/\/auth\/login$/);
      await expect(new Header(page).userMenu).toBeHidden();
    });

    test('TC_LOGIN_021 | Failed-attempt counter resets after a successful login', async ({
      page,
      request,
    }) => {
      const user = await createTestUser(request);
      const login = new LoginPage(page);
      const header = new Header(page);
      await login.goto();

      for (let attempt = 1; attempt <= 2; attempt++) {
        expect((await login.login(user.email, WRONG_PASSWORD)).status()).toBe(401);
      }
      expect((await login.login(user.email, user.password)).status()).toBe(200);
      await expect(page).toHaveURL(/\/account$/);
      await header.logout();
      await expect(header.signIn).toBeVisible();

      await login.goto();
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await login.login(user.email, WRONG_PASSWORD);
        expect(response.status(), `attempt ${attempt} after reset`).toBe(401);
        await expect(login.loginError).toHaveText(INVALID_LOGIN_MESSAGE);
      }
    });

    test('TC_LOGIN_022 | Admin can unlock a locked account', async ({ page, request }) => {
      const user = await createTestUser(request);
      await lockTestUser(request, user);
      const login = new LoginPage(page);
      const header = new Header(page);
      const users = new AdminUsersPage(page);
      const editUser = new AdminEditUserPage(page);

      await login.goto();
      expect((await login.login(env.admin.email, env.admin.password)).status()).toBe(200);
      await expect(page).toHaveURL(/\/admin\/dashboard$/);

      await users.goto();
      await users.search(user.email);
      await users.editButton(user.id).click();
      await expect(editUser.email).toHaveValue(user.email);
      await expect(editUser.failedLoginAttempts).not.toHaveValue('0');
      await editUser.failedLoginAttempts.fill('0');
      await expect(editUser.enabled).toBeChecked();
      const saveResponse = await editUser.submit(user.id);
      expect(saveResponse.status()).toBe(200);

      await header.logout();
      await expect(header.signIn).toBeVisible();
      await login.goto();
      const response = await login.login(user.email, user.password);

      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(/\/account$/);
    });
  });
});
