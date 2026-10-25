import type { Locator, Page, Response } from '@playwright/test';

/** Admin > Users list (/admin/users). */
export class AdminUsersPage {
  readonly searchQuery: Locator;
  readonly searchSubmit: Locator;

  constructor(readonly page: Page) {
    this.searchQuery = page.getByTestId('user-search-query');
    this.searchSubmit = page.getByTestId('user-search-submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/users');
  }

  async search(text: string): Promise<void> {
    await this.searchQuery.fill(text);
    await this.searchSubmit.click();
  }

  editButton(userId: string): Locator {
    return this.page.getByTestId(`user-edit-${userId}`);
  }
}

/** Admin > Users > Edit User (/admin/users/edit/:id). */
export class AdminEditUserPage {
  readonly email: Locator;
  readonly failedLoginAttempts: Locator;
  readonly enabled: Locator;
  readonly save: Locator;

  constructor(readonly page: Page) {
    this.email = page.getByTestId('email');
    this.failedLoginAttempts = page.getByTestId('failed_login_attempts');
    this.enabled = page.getByTestId('enabled');
    this.save = page.getByTestId('user-submit');
  }

  /** Clicks Save and returns the PUT /users/:id response. */
  async submit(userId: string): Promise<Response> {
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.url().endsWith(`/users/${userId}`) && r.request().method() === 'PUT',
      ),
      this.save.click(),
    ]);
    return response;
  }
}
