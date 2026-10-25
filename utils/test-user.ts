import { expect, type APIRequestContext } from '@playwright/test';
import { ApiClient, type NewUser } from '../pages/api';
import { uniqueEmail } from './email-generator';
import { randomFirstName, randomLastName } from './name-generator';

/** Failed logins allowed before the API locks an account (the next attempt returns 423). */
export const MAX_FAILED_LOGINS = 3;
export const ACCOUNT_LOCKED_MESSAGE =
  'Account locked, too many failed attempts. Please contact the administrator.';
export const WRONG_PASSWORD = 'Wrong!Pass123';

export interface TestUser extends NewUser {
  id: string;
}

/**
 * Registers a brand-new customer through the API.
 * Use it for any test that changes account state, so shared demo accounts stay untouched.
 */
export async function createTestUser(request: APIRequestContext): Promise<TestUser> {
  const user: NewUser = {
    first_name: randomFirstName(),
    last_name: randomLastName(),
    email: uniqueEmail(),
    password: `Qa!${Math.random().toString(36).slice(2, 8)}A9x`,
  };
  const { id } = await new ApiClient(request).register(user);
  return { ...user, id };
}

/** Locks the account by sending wrong passwords through the API. */
export async function lockTestUser(request: APIRequestContext, user: TestUser): Promise<void> {
  const api = new ApiClient(request);
  for (let attempt = 1; attempt <= MAX_FAILED_LOGINS; attempt++) {
    const response = await api.login({ email: user.email, password: WRONG_PASSWORD });
    expect(response.status()).toBe(401);
  }
  const locked = await api.login({ email: user.email, password: user.password });
  expect(locked.status()).toBe(423);
}
