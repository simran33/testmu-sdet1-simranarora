import type { APIResponse } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ApiClient } from '../../pages/api';
import { env } from '../../utils/env';
import { expectShape } from '../../utils/schema';
import { createBrand, deleteBrand } from '../../utils/test-data';
import { createTestUser } from '../../utils/test-user';

const NO_STACK_TRACE = /stack ?trace|exception|\/var\/www|vendor\/laravel|SQLSTATE/i;

/** Rate-limit tests send bursts of requests; the approved cases say to run them on a test environment only. */
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_TESTS === 'true';
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 150);

/** Sends requests one after another until one returns 429, or the limit of requests is used up. */
async function sendUntilRateLimited(send: () => Promise<APIResponse>): Promise<APIResponse | undefined> {
  for (let i = 0; i < RATE_LIMIT_MAX_REQUESTS; i++) {
    const response = await send();
    if (response.status() === 429) return response;
  }
  return undefined;
}

test.describe('REST API', () => {
  let api: ApiClient;

  test.beforeEach(({ request }) => {
    api = new ApiClient(request);
  });

  test.describe('Auth token validation', () => {
    test.only('TC_API_046 | Login API returns a bearer token for valid credentials', async () => {
      const response = await api.login(env.customer);

      expect(response.status()).toBe(200);
      const body = await response.json();
      expect(body.access_token).toEqual(expect.any(String));
      expect(body.access_token.split('.'), 'JWT has three parts').toHaveLength(3);
      expect(body.token_type).toBe('bearer');
      expect(body.expires_in).toBe(300);
    });

    test('TC_API_047 | Protected endpoint accepts a valid token', async () => {
      const token = await api.token(env.customer);

      const response = await api.me(token);

      expect(response.status()).toBe(200);
      const me = await response.json();
      expect(me.email).toBe(env.customer.email);
      expectShape(me, { id: 'string', first_name: 'string', last_name: 'string', email: 'string' }, 'user');
    });

    test('TC_API_048 | Protected endpoint rejects a request with no token', async () => {
      const response = await api.get('/users/me');

      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual({ message: 'Unauthorized' });
    });

    test('TC_API_049 | Protected endpoint rejects a malformed or tampered token', async () => {
      const token = await api.token(env.customer);
      const lastChar = token.slice(-1);
      const tampered = token.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');

      expect((await api.me(tampered)).status(), 'tampered signature').toBe(401);
      expect((await api.me('abc.def.ghi')).status(), 'random string').toBe(401);
    });

    test('TC_API_050 | Expired token is rejected and can be refreshed before expiry', async ({ request }) => {
      // Waits for the 300 s token lifetime to pass. Uses GET /users/refresh (token refresh), never POST /refresh.
      test.setTimeout(10 * 60_000);
      const user = await createTestUser(request);
      const oldToken = await api.token(user);

      const refresh = await api.get('/users/refresh', oldToken);
      expect(refresh.status()).toBe(200);
      const newToken = (await refresh.json()).access_token;
      expect(newToken).toEqual(expect.any(String));
      expect(newToken).not.toBe(oldToken);
      expect((await api.me(newToken)).status(), 'refreshed token works').toBe(200);

      await expect
        .poll(async () => (await api.me(oldToken)).status(), {
          message: 'old token is rejected once expired',
          timeout: 7 * 60_000,
          intervals: [15_000],
        })
        .toBe(401);
    });

    test('TC_API_051 | Token is invalid after logout', async ({ request }) => {
      const user = await createTestUser(request);
      const token = await api.token(user);

      const logout = await api.get('/users/logout', token);
      expect(logout.status()).toBe(200);

      expect((await api.me(token)).status()).toBe(401);
    });
  });

  test.describe('CRUD operations', () => {
    let adminToken: string;
    const created: string[] = [];

    test.beforeEach(async () => {
      adminToken = await api.token(env.admin);
    });

    test.afterEach(async () => {
      while (created.length) await deleteBrand(api, adminToken, created.pop()!);
    });

    test('TC_API_052 | Create a brand (POST)', async () => {
      const unique = Date.now();
      const data = { name: `QA Brand ${unique}`, slug: `qa-brand-${unique}` };

      const response = await api.post('/brands', data, adminToken);

      expect(response.status()).toBe(201);
      const brand = await response.json();
      created.push(brand.id);
      expect(brand.id).toEqual(expect.any(String));
      expect(brand).toMatchObject(data);
    });

    test('TC_API_053 | Read a brand by id (GET)', async () => {
      const brand = await createBrand(api, adminToken);
      created.push(brand.id);

      const response = await api.get(`/brands/${brand.id}`);

      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ id: brand.id, name: brand.name, slug: brand.slug });
    });

    test('TC_API_054 | Update a brand (PUT and PATCH)', async () => {
      const brand = await createBrand(api, adminToken);
      created.push(brand.id);

      const put = await api.put(`/brands/${brand.id}`, { name: 'QA Brand Updated', slug: `${brand.slug}-put` }, adminToken);
      expect(put.status()).toBe(200);
      expect(await (await api.get(`/brands/${brand.id}`)).json()).toMatchObject({
        name: 'QA Brand Updated',
        slug: `${brand.slug}-put`,
      });

      const patch = await api.patch(`/brands/${brand.id}`, { slug: `${brand.slug}-patched` }, adminToken);
      expect(patch.status()).toBe(200);
      expect(await (await api.get(`/brands/${brand.id}`)).json(), 'PATCH changes only the slug').toMatchObject({
        name: 'QA Brand Updated',
        slug: `${brand.slug}-patched`,
      });
    });

    test('TC_API_055 | Delete a brand (DELETE)', async () => {
      const brand = await createBrand(api, adminToken);
      created.push(brand.id);

      const response = await api.delete(`/brands/${brand.id}`, adminToken);

      expect(response.status()).toBe(204);
      expect((await api.get(`/brands/${brand.id}`)).status()).toBe(404);
    });

    test.only('TC_API_056 | Customer token cannot create, update or delete admin data', async ({ request }) => {
      // A fresh customer, so the demo customer is not used for write attempts.
      const customerToken = await api.token(await createTestUser(request));
      const existing = await createBrand(api, adminToken);
      created.push(existing.id);
      const unique = Date.now();

      const create = await api.post('/brands', { name: `QA Customer ${unique}`, slug: `qa-customer-${unique}` }, customerToken);
      if (create.status() === 201) created.push((await create.json()).id);
      expect.soft([401, 403], `POST /brands as customer returned ${create.status()}`).toContain(create.status());

      const remove = await api.delete(`/brands/${existing.id}`, customerToken);
      expect.soft([401, 403], `DELETE /brands as customer returned ${remove.status()}`).toContain(remove.status());
      expect((await api.get(`/brands/${existing.id}`)).status(), 'brand still exists').toBe(200);
    });
  });

  test.describe('Error handling (4xx/5xx)', () => {
    test('TC_API_057 | GET with a non-existent id returns 404', async () => {
      const response = await api.get('/products/01AAAAAAAAAAAAAAAAAAAAAAAA');

      expect(response.status()).toBe(404);
      expect(response.headers()['content-type']).toContain('application/json');
      const text = await response.text();
      expect(JSON.parse(text).message).toEqual(expect.any(String));
      expect(text).not.toMatch(NO_STACK_TRACE);
    });

    test('TC_API_058 | POST with missing required fields returns 422', async () => {
      const adminToken = await api.token(env.admin);

      const response = await api.post('/brands', {}, adminToken);

      expect(response.status()).toBe(422);
      const errors = await response.json();
      expect(errors.name).toEqual([expect.any(String)]);
      expect(errors.slug).toEqual([expect.any(String)]);
    });

    test('TC_API_059 | Creating a duplicate brand slug returns 409 or 422', async () => {
      const adminToken = await api.token(env.admin);
      const brand = await createBrand(api, adminToken);
      try {
        const response = await api.post('/brands', { name: 'Dup', slug: brand.slug }, adminToken);

        expect([409, 422]).toContain(response.status());
        expect(JSON.stringify(await response.json())).toMatch(/slug/i);
        const allBrands = await (await api.get('/brands')).json();
        expect(allBrands.filter((b: { slug: string }) => b.slug === brand.slug), 'no duplicate created').toHaveLength(1);
      } finally {
        await deleteBrand(api, adminToken, brand.id);
      }
    });

    test('TC_API_060 | Unsupported HTTP method returns 405', async () => {
      const adminToken = await api.token(env.admin);

      const response = await api.delete('/brands', adminToken);

      expect(response.status()).toBe(405);
    });

    test('TC_API_061 | Malformed JSON body returns 400-level error, not 500', async () => {
      const adminToken = await api.token(env.admin);

      const response = await api.postRaw('/brands', '{"name": "x",', adminToken);

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
      expect(await response.text()).not.toMatch(NO_STACK_TRACE);
    });
  });

  test.describe('Rate limiting', () => {
    test.skip(!RATE_LIMIT_ENABLED, 'Burst tests run only on a test environment: set RATE_LIMIT_TESTS=true');

    test('TC_API_063 | 429 response includes a Retry-After header', async () => {
      const limited = await sendUntilRateLimited(() => api.get('/products'));

      expect(limited, `429 within ${RATE_LIMIT_MAX_REQUESTS} requests`).toBeDefined();
      expect(limited!.headers()['retry-after']).toMatch(/^\d+$/);
    });

    test('TC_API_064 | Requests succeed again after the wait period', async () => {
      const limited = await sendUntilRateLimited(() => api.get('/products'));
      expect(limited, `429 within ${RATE_LIMIT_MAX_REQUESTS} requests`).toBeDefined();
      const retryAfter = Number(limited!.headers()['retry-after'] ?? 60);
      test.setTimeout((retryAfter + 60) * 1000);

      await expect
        .poll(async () => (await api.get('/products')).status(), {
          message: 'GET /products works again after Retry-After',
          timeout: (retryAfter + 30) * 1000,
          intervals: [5_000],
        })
        .toBe(200);
    });

    test('TC_API_065 | Login endpoint is rate limited against brute force', async () => {
      // Unregistered email, so no real account gets locked.
      const email = `not.registered.${Date.now()}@example.com`;

      const limited = await sendUntilRateLimited(() => api.login({ email, password: 'Wrong!Pass123' }));

      expect(limited, `login blocked with 429 within ${RATE_LIMIT_MAX_REQUESTS} attempts`).toBeDefined();
    });
  });

  test.describe('Schema validation', () => {
    const productShape = {
      id: 'string',
      name: 'string',
      description: 'string',
      price: 'number',
      is_location_offer: 'boolean',
      is_rental: 'boolean',
      in_stock: 'boolean',
      co2_rating: 'string',
      is_eco_friendly: 'boolean',
      brand: 'object',
      category: 'object',
    } as const;

    test('TC_API_066 | GET /products response matches the documented schema', async () => {
      const response = await api.get('/products?page=1');

      expect(response.status()).toBe(200);
      const body = await response.json();
      expectShape(
        body,
        { current_page: 'number', data: 'array', from: 'number', last_page: 'number', per_page: 'number', to: 'number', total: 'number' },
        'page',
      );
      expect(body.data.length).toBeGreaterThan(0);
      body.data.forEach((product: Record<string, unknown>, i: number) =>
        expectShape(product, productShape, `data[${i}]`),
      );
    });

    test.only('TC_API_067 | Product field types are correct', async () => {
      const id = (await (await api.get('/products?page=1')).json()).data[0].id;

      const response = await api.get(`/products/${id}`);

      expect(response.status()).toBe(200);
      const product = await response.json();
      expectShape(product, productShape, 'product');
      expectShape(product.brand, { id: 'string', name: 'string', slug: 'string' }, 'product.brand');
      expectShape(product.category, { id: 'string', name: 'string', slug: 'string' }, 'product.category');
    });

    test('TC_API_068 | GET /users/me response matches the user schema and hides secrets', async () => {
      const token = await api.token(env.customer);

      const response = await api.me(token);

      expect(response.status()).toBe(200);
      const me = await response.json();
      expectShape(me, { id: 'string', first_name: 'string', last_name: 'string', email: 'string', address: 'object' }, 'user');
      expectShape(
        me.address,
        {
          street: ['string', 'null'],
          city: ['string', 'null'],
          state: ['string', 'null'],
          country: ['string', 'null'],
          postal_code: ['string', 'null'],
        },
        'user.address',
      );
      const keys = Object.keys(me).join(',');
      expect(keys).not.toMatch(/password|hash|token|secret/i);
    });

    test('TC_API_069 | Error responses use a consistent JSON format', async () => {
      const adminToken = await api.token(env.admin);
      const errors = [
        { label: '404', response: await api.get('/products/01AAAAAAAAAAAAAAAAAAAAAAAA') },
        { label: '401', response: await api.get('/users/me') },
        { label: '422', response: await api.post('/brands', {}, adminToken) },
      ];

      for (const { label, response } of errors) {
        expect(response.status(), label).toBe(Number(label));
        expect(response.headers()['content-type'], `${label} content type`).toContain('application/json');
        const body = await response.json();
        const hasMessage = typeof body.message === 'string';
        const hasFieldErrors =
          Object.keys(body).length > 0 &&
          Object.values(body).every((v) => Array.isArray(v) && v.every((m) => typeof m === 'string'));
        expect(hasMessage || hasFieldErrors, `${label} body ${JSON.stringify(body)}`).toBe(true);
      }
    });

    test('TC_API_070 | Pagination fields are consistent with the data returned', async () => {
      const first = await (await api.get('/products?page=1')).json();
      const last = await (await api.get(`/products?page=${first.last_page}`)).json();

      expect(first.data).toHaveLength(first.per_page);
      expect(first.to - first.from + 1).toBe(first.data.length);
      expect(last.current_page).toBe(first.last_page);
      expect(last.data).toHaveLength(first.total - (first.last_page - 1) * first.per_page);
      expect(last.to - last.from + 1).toBe(last.data.length);
      expect(last.to).toBe(first.total);
    });
  });
});
