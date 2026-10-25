import type { Locator, Page, Response } from '@playwright/test';

export class LoginPage {
  readonly form: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly emailError: Locator;
  readonly passwordError: Locator;
  readonly loginError: Locator;
  readonly forgotPasswordLink: Locator;

  constructor(readonly page: Page) {
    this.form = page.getByTestId('login-form');
    this.email = page.getByTestId('email');
    this.password = page.getByTestId('password');
    this.submit = page.getByTestId('login-submit');
    this.emailError = page.getByTestId('email-error');
    this.passwordError = page.getByTestId('password-error');
    this.loginError = page.getByTestId('login-error');
    this.forgotPasswordLink = page.getByTestId('forgot-password-link');
  }

  async goto(): Promise<void> {
    await this.page.goto('/auth/login');
  }

  async fill(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
  }

  /** Submits the form and returns the POST /users/login response. */
  async login(email: string, password: string): Promise<Response> {
    await this.fill(email, password);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().endsWith('/users/login') && r.request().method() === 'POST',
      ),
      this.submit.click(),
    ]);
    return response;
  }
}

export class ForgotPasswordPage {
  readonly form: Locator;
  readonly email: Locator;
  readonly submit: Locator;
  readonly emailError: Locator;
  /** Result banner (success or error); the app renders it without a data-test attribute. */
  readonly resultAlert: Locator;
  readonly successAlert: Locator;

  constructor(readonly page: Page) {
    this.form = page.getByTestId('forgot-password-form');
    this.email = this.form.getByTestId('email');
    this.submit = page.getByTestId('forgot-password-submit');
    this.emailError = page.getByTestId('email-error');
    this.resultAlert = this.form.getByRole('alert');
    this.successAlert = this.resultAlert.and(this.form.locator('.alert-success'));
  }

  async goto(): Promise<void> {
    await this.page.goto('/auth/forgot-password');
  }

  /** Submits the email and returns the POST /users/forgot-password response. */
  async requestReset(email: string): Promise<Response> {
    await this.email.fill(email);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().endsWith('/users/forgot-password') && r.request().method() === 'POST',
      ),
      this.submit.click(),
    ]);
    return response;
  }
}
