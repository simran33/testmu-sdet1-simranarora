import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { ApiClient, type UserCredentials } from '../pages/api';
import type { TestUser } from './test-user';

const TOKEN_KEY = 'auth-token';

/**
 * Logs in through the API and puts the token in localStorage before the app loads,
 * so UI tests that are not about login skip the login form.
 */
export async function loginViaApi(
  page: Page,
  request: APIRequestContext,
  credentials: UserCredentials,
): Promise<string> {
  const token = await new ApiClient(request).token(credentials);
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [TOKEN_KEY, token],
  );
  return token;
}

export interface PlacedOrder {
  id: string;
  invoice_number: string;
  total: number;
}

/**
 * Places a cash-on-delivery order for one in-stock product as the given user.
 * The billing address comes from the postcode lookup, the same way the checkout fills it.
 */
export async function placeOrder(request: APIRequestContext, user: TestUser): Promise<PlacedOrder> {
  const api = new ApiClient(request);
  const token = await api.token(user);

  const products = await (await api.get('/products?page=1')).json();
  const product = products.data.find(
    (p: { in_stock: boolean; is_rental: boolean }) => p.in_stock && !p.is_rental,
  );
  expect(product, 'an in-stock product to order').toBeTruthy();

  const cart = await (await api.post('/carts')).json();
  const added = await api.post(`/carts/${cart.id}`, { product_id: product.id, quantity: 1 });
  expect(added.status()).toBe(200);

  const address = await (await api.get('/postcode-lookup?country=NL&postcode=1012LG&house_number=1')).json();
  const invoice = await api.post(
    '/invoices',
    {
      billing_street: address.street,
      billing_city: address.city,
      billing_state: address.state,
      billing_country: address.country,
      billing_postal_code: address.postcode,
      payment_method: 'cash-on-delivery',
      payment_details: {},
      cart_id: cart.id,
    },
    token,
  );
  expect(invoice.status(), await invoice.text()).toBe(201);
  return invoice.json();
}

/** Creates a brand with a unique slug as admin. */
export async function createBrand(
  api: ApiClient,
  adminToken: string,
): Promise<{ id: string; name: string; slug: string }> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const response = await api.post('/brands', { name: `QA Brand ${unique}`, slug: `qa-brand-${unique}` }, adminToken);
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

/** Deletes a brand as admin; ignores brands that are already gone. */
export async function deleteBrand(api: ApiClient, adminToken: string, id: string): Promise<void> {
  const response = await api.delete(`/brands/${id}`, adminToken);
  expect([204, 404]).toContain(response.status());
}
