import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { env } from '../utils/env';

export interface UserCredentials {
  email: string;
  password: string;
}

export interface NewUser extends UserCredentials {
  first_name: string;
  last_name: string;
}

type Body = Record<string, unknown>;

/** Thin client for the Practice Software Testing REST API. */
export class ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  private url(path: string): string {
    return `${env.apiUrl}${path}`;
  }

  private headers(token?: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  get(path: string, token?: string): Promise<APIResponse> {
    return this.request.get(this.url(path), { headers: this.headers(token) });
  }

  post(path: string, data?: Body, token?: string): Promise<APIResponse> {
    return this.request.post(this.url(path), { data, headers: this.headers(token) });
  }

  put(path: string, data: Body, token?: string): Promise<APIResponse> {
    return this.request.put(this.url(path), { data, headers: this.headers(token) });
  }

  patch(path: string, data: Body, token?: string): Promise<APIResponse> {
    return this.request.patch(this.url(path), { data, headers: this.headers(token) });
  }

  delete(path: string, token?: string): Promise<APIResponse> {
    return this.request.delete(this.url(path), { headers: this.headers(token) });
  }

  /** Sends a raw JSON string, e.g. to test malformed bodies. */
  postRaw(path: string, body: string, token?: string): Promise<APIResponse> {
    return this.request.post(this.url(path), {
      data: body,
      headers: { ...this.headers(token), 'Content-Type': 'application/json' },
    });
  }

  async register(user: NewUser): Promise<{ id: string }> {
    const response = await this.post('/users/register', {
      ...user,
      dob: '1990-01-01',
      phone: '0612345678',
      address: {
        street: 'Main Street',
        house_number: '1',
        city: 'Amsterdam',
        state: 'Noord-Holland',
        country: 'NL',
        postal_code: '1011AB',
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }

  login(credentials: UserCredentials): Promise<APIResponse> {
    return this.post('/users/login', { ...credentials });
  }

  /** Logs in and returns the access token. */
  async token(credentials: UserCredentials): Promise<string> {
    const response = await this.login(credentials);
    expect(response.status(), `login as ${credentials.email}`).toBe(200);
    return (await response.json()).access_token;
  }

  me(token: string): Promise<APIResponse> {
    return this.get('/users/me', token);
  }
}
