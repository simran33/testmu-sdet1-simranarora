import type { Page, Response } from '@playwright/test';
import { test, expect } from '../fixtures';
import { ApiClient } from '../../pages/api';
import { AdminOrdersPage, AdminProductsPage } from '../../pages/admin-lists';
import {
  AccountPage,
  AdminDashboardPage,
  Header,
  InvoiceDetailPage,
  InvoicesPage,
  ProfilePage,
} from '../../pages/dashboard';
import { env } from '../../utils/env';
import { loginViaApi, placeOrder } from '../../utils/test-data';
import { createTestUser } from '../../utils/test-user';

type YearTotal = { year: number; total: number };

const SALES_REPORT = '/reports/total-sales-of-years';

/** Opens the admin dashboard and returns the sales report response the chart is drawn from. */
async function openDashboard(page: Page): Promise<Response> {
  const [report] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes(SALES_REPORT)),
    new AdminDashboardPage(page).goto(),
  ]);
  return report;
}

async function hasHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

const money = (value: number) => `$${value.toFixed(2)}`;

test.describe('Dashboard', () => {
  test.describe('Widget loading', () => {
    test('TC_DASHBOARD_023 | Admin dashboard loads all widgets', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const dashboard = new AdminDashboardPage(page);
      const consoleErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });

      const report = await openDashboard(page);

      expect(report.status()).toBe(200);
      await expect(dashboard.pageTitle).toHaveText('Sales over the years');
      await expect(dashboard.salesChart).toBeVisible();
      await expect(dashboard.latestOrdersHeading).toBeVisible();
      await expect(dashboard.latestOrdersRows.first()).toBeVisible();
      expect(consoleErrors).toEqual([]);
    });

    test('TC_DASHBOARD_024 | Dashboard loads within an acceptable time', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const dashboard = new AdminDashboardPage(page);

      const start = Date.now();
      await openDashboard(page);
      await expect(dashboard.salesChart).toBeVisible();
      await expect(dashboard.latestOrdersRows.first()).toBeVisible();
      const elapsed = Date.now() - start;

      test.info().annotations.push({ type: 'load time (ms)', description: String(elapsed) });
      expect(elapsed, 'all widgets rendered within 3 s').toBeLessThan(3000);
    });

    test('TC_DASHBOARD_025 | Dashboard shows a loading indicator on slow network', async ({
      page,
      request,
    }) => {
      await loginViaApi(page, request, env.admin);
      const header = new Header(page);
      const dashboard = new AdminDashboardPage(page);
      await new AdminOrdersPage(page).goto();
      await expect(header.userMenu).toBeVisible();

      // Slow 3G-like conditions, switched on after the app shell has loaded.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 2000,
        downloadThroughput: (500 * 1024) / 8,
        uploadThroughput: (500 * 1024) / 8,
      });
      await header.openUserMenu();
      await page.getByTestId('nav-admin-dashboard').click();

      const loadingIndicator = page
        .getByRole('status')
        .or(page.getByRole('progressbar'))
        .or(page.getByText(/loading/i));
      await expect(loadingIndicator.first(), 'a loading state while the report is on its way').toBeVisible();
      await expect(dashboard.pageTitle).toHaveText('Sales over the years');
    });

    test.only('TC_DASHBOARD_026 | Widget shows an error message when its data fails to load', async ({
      page,
      request,
    }) => {
      await loginViaApi(page, request, env.admin);
      const dashboard = new AdminDashboardPage(page);
      await page.route('**/reports/**', (route) => route.abort());

      await dashboard.goto();

      // The rest of the page keeps working.
      await expect(dashboard.pageTitle).toHaveText('Sales over the years');
      await expect(dashboard.latestOrdersRows.first()).toBeVisible();
      // The failed widget tells the user.
      const errorMessage = page
        .getByRole('alert')
        .or(page.getByText(/error|failed|could not|unable|try again/i));
      await expect(errorMessage.first(), 'error or empty-state message for the chart').toBeVisible();
    });

    test('TC_DASHBOARD_027 | Customer account page loads all tiles', async ({ page, request }) => {
      await loginViaApi(page, request, env.customer);
      const account = new AccountPage(page);
      const tiles = [
        { tile: account.favoritesTile, url: /\/account\/favorites$/, title: 'Favorites' },
        { tile: account.profileTile, url: /\/account\/profile$/, title: 'Profile' },
        { tile: account.invoicesTile, url: /\/account\/invoices$/, title: 'Invoices' },
        { tile: account.messagesTile, url: /\/account\/messages$/, title: 'Messages' },
      ];

      for (const { tile, url, title } of tiles) {
        await account.goto();
        await expect(account.pageTitle).toHaveText('My account');
        await expect(tile).toBeVisible();
        await tile.click();
        await expect(page).toHaveURL(url);
        await expect(account.pageTitle).toHaveText(title);
      }
    });
  });

  test.describe('Data accuracy', () => {
    test('TC_DASHBOARD_028 | Sales-per-year chart matches the reports API', async ({ page, request }) => {
      const token = await loginViaApi(page, request, env.admin);

      // The chart is a canvas, so its values are read from the response it is drawn from.
      const report = await openDashboard(page);
      const chartData: YearTotal[] = await report.json();
      await expect(new AdminDashboardPage(page).salesChart).toBeVisible();

      const years = new URL(report.url()).searchParams.get('years');
      const api = await new ApiClient(request).get(`${SALES_REPORT}?years=${years}`, token);
      expect(api.status()).toBe(200);
      expect(chartData).toEqual(await api.json());
    });

    test('TC_DASHBOARD_029 | Dashboard totals update after a new order', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const totalFor = (rows: YearTotal[], year: number) => rows.find((r) => r.year === year)?.total ?? 0;
      const year = new Date().getFullYear();

      const before: YearTotal[] = await (await openDashboard(page)).json();

      // The order is placed by a fresh customer, so the demo accounts get no new invoices.
      const order = await placeOrder(request, await createTestUser(request));

      const after: YearTotal[] = await (await openDashboard(page)).json();
      expect(
        totalFor(after, year),
        `${year} total should grow by the new order (${money(order.total)})`,
      ).toBeGreaterThanOrEqual(totalFor(before, year) + order.total - 0.005);
    });

    test("TC_DASHBOARD_030 | Customer invoices list shows only the customer's own orders with correct amounts", async ({
      page,
      request,
    }) => {
      const token = await loginViaApi(page, request, env.customer);
      const invoices = new InvoicesPage(page);
      const detail = new InvoiceDetailPage(page);
      const me = await (await new ApiClient(request).me(token)).json();

      const [listResponse] = await Promise.all([
        page.waitForResponse((r) => r.request().method() === 'GET' && /\/invoices\?page=1$/.test(r.url())),
        invoices.goto(),
      ]);
      const list = (await listResponse.json()).data as {
        user_id: string;
        invoice_number: string;
        total: number;
      }[];
      expect(list.length).toBeGreaterThan(0);
      expect(list.every((invoice) => invoice.user_id === me.id), 'all invoices belong to the customer').toBe(true);

      await expect(invoices.rows).toHaveCount(list.length);
      expect(await invoices.rows.locator('td:nth-child(1)').allInnerTexts()).toEqual(
        list.map((i) => i.invoice_number),
      );
      expect(await invoices.rows.locator('td:nth-child(4)').allInnerTexts()).toEqual(
        list.map((i) => money(i.total)),
      );

      await invoices.detailsLink(invoices.rows.first()).click();
      await expect(detail.invoiceNumber).toHaveValue(list[0].invoice_number);
      await expect(detail.total).toHaveValue(`$ ${list[0].total.toFixed(2)}`);
    });

    test('TC_DASHBOARD_031 | Customer profile data matches the account details', async ({ page, request }) => {
      const token = await loginViaApi(page, request, env.customer);
      const profile = new ProfilePage(page);
      const me = await (await new ApiClient(request).me(token)).json();

      await profile.goto();

      await expect(profile.pageTitle).toHaveText('Profile');
      await expect(profile.firstName).toHaveValue(me.first_name);
      await expect(profile.lastName).toHaveValue(me.last_name);
      await expect(profile.email).toHaveValue(me.email);
      await expect(profile.phone).toHaveValue(me.phone ?? '');
      await expect(profile.street).toHaveValue(me.address.street ?? '');
      await expect(profile.postalCode).toHaveValue(me.address.postal_code ?? '');
      await expect(profile.city).toHaveValue(me.address.city ?? '');
      await expect(profile.state).toHaveValue(me.address.state ?? '');
      await expect(profile.country).toHaveValue(me.address.country ?? '');
    });
  });

  test.describe('Filter/sort', () => {
    test('TC_DASHBOARD_032 | Admin Orders list can be searched', async ({ page, request }) => {
      const token = await loginViaApi(page, request, env.admin);
      const orders = new AdminOrdersPage(page);
      const latest = (await (await new ApiClient(request).get('/invoices?page=1', token)).json()).data[0];

      await orders.goto();
      await expect(orders.rows.first()).toBeVisible();
      const response = await orders.search(latest.invoice_number);

      expect(response.status()).toBe(200);
      await expect(orders.rows.first()).toContainText(latest.invoice_number);
      for (const invoiceNumber of await orders.columnValues(1)) {
        expect(invoiceNumber).toContain(latest.invoice_number);
      }
    });

    test('TC_DASHBOARD_033 | Admin Products list can be sorted by name and price', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const products = new AdminProductsPage(page);
      const byText = (a: string, b: string) => a.localeCompare(b);
      const price = (text: string) => Number(text.replace(/[^0-9.]/g, ''));

      await products.goto();
      await expect(products.rows.first()).toBeVisible();

      const checks = [
        { header: 'Name', column: AdminProductsPage.NAME_COLUMN, compare: byText, label: 'name A-Z' },
        { header: 'Name', column: AdminProductsPage.NAME_COLUMN, compare: (a: string, b: string) => byText(b, a), label: 'name Z-A' },
        { header: 'Price', column: AdminProductsPage.PRICE_COLUMN, compare: (a: string, b: string) => price(a) - price(b), label: 'price low-high' },
        { header: 'Price', column: AdminProductsPage.PRICE_COLUMN, compare: (a: string, b: string) => price(b) - price(a), label: 'price high-low' },
      ];
      for (const { header, column, compare, label } of checks) {
        await products.columnHeader(header).click();
        await expect
          .poll(
            async () => {
              const values = await products.columnValues(column);
              return values.join('|') === [...values].sort(compare).join('|');
            },
            { message: `products sorted by ${label}` },
          )
          .toBe(true);
      }
    });

    test('TC_DASHBOARD_034 | Search with no matches shows an empty state', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const orders = new AdminOrdersPage(page);

      await orders.goto();
      await expect(orders.rows.first()).toBeVisible();
      const response = await orders.search('zzqqxx_nomatch');

      expect(response.status()).toBe(200);
      await expect(orders.rows).toHaveCount(0);
      await expect(
        page.getByText(/no (results|orders|records|data|items|matches)|nothing found/i),
        'a "no results" message',
      ).toBeVisible();
    });

    test.only('TC_DASHBOARD_035 | Filter is kept when moving between pages of results', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const products = new AdminProductsPage(page);
      const query = 'a';

      await products.goto();
      await expect(products.rows.first()).toBeVisible();
      const firstPage = await (await products.search(query)).json();
      expect(firstPage.last_page, 'search returns more than one page').toBeGreaterThan(1);

      // The admin list loads pages with HTTP QUERY requests (page number in the body).
      await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'QUERY' && /\/products(\/search)?$/.test(new URL(r.url()).pathname),
        ),
        products.pageButton(2).click(),
      ]);
      const expected = await (await new ApiClient(request).get(`/products/search?q=${query}&page=2`)).json();
      const expectedNames = expected.data.map((p: { name: string }) => p.name);

      await expect
        .poll(() => products.columnValues(AdminProductsPage.NAME_COLUMN), {
          message: `page 2 shows only results for "${query}"`,
        })
        .toEqual(expectedNames);
      await expect(products.searchQuery).toHaveValue(query);
    });

    test('TC_DASHBOARD_036 | Special characters in search are handled safely', async ({ page, request }) => {
      await loginViaApi(page, request, env.admin);
      const products = new AdminProductsPage(page);
      const payload = '<script>alert(1)</script>';
      const dialogs: string[] = [];
      page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });

      await products.goto();
      await expect(products.rows.first()).toBeVisible();
      const response = await products.search(payload);

      expect(response.status()).toBeLessThan(500);
      await expect(products.pageTitle).toHaveText('Products');
      await expect(products.searchQuery).toHaveValue(payload);
      await expect(page.locator('body')).not.toContainText(/SQLSTATE|exception|stack trace/i);
      expect(dialogs, 'no script ran').toEqual([]);
    });
  });

  test.describe('Responsive layout', () => {
    test.describe('mobile', () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test.only('TC_DASHBOARD_037 | Dashboard layout on mobile width', async ({ page, request }) => {
        await loginViaApi(page, request, env.admin);
        const header = new Header(page);
        const dashboard = new AdminDashboardPage(page);

        await openDashboard(page);
        await expect(dashboard.salesChart).toBeVisible();
        await expect(dashboard.latestOrdersRows.first()).toBeVisible();

        const chart = await dashboard.salesChart.boundingBox();
        expect(chart!.width, 'chart fits the screen').toBeLessThanOrEqual(375);
        await expect(header.mobileToggle, 'menu collapses into a hamburger').toBeVisible();
        await expect(header.userMenu).toBeHidden();
        expect(await hasHorizontalScroll(page), 'no horizontal scrolling').toBe(false);
      });

      test('TC_DASHBOARD_040 | Navigation menu works on mobile', async ({ page, request }) => {
        await loginViaApi(page, request, env.customer);
        const header = new Header(page);
        const account = new AccountPage(page);
        const items = [
          { link: header.myFavorites, url: /\/account\/favorites$/ },
          { link: header.myProfile, url: /\/account\/profile$/ },
          { link: header.myInvoices, url: /\/account\/invoices$/ },
          { link: header.myMessages, url: /\/account\/messages$/ },
          { link: header.myAccount, url: /\/account$/ },
        ];
        await account.goto();
        await expect(account.pageTitle).toHaveText('My account');

        for (const { link, url } of items) {
          await expect(header.mobileToggle).toBeVisible();
          if (!(await header.userMenu.isVisible())) await header.mobileToggle.click();
          await header.openUserMenu();
          await link.click();
          await expect(page).toHaveURL(url);
        }

        // The menu also closes again.
        if (!(await header.userMenu.isVisible())) await header.mobileToggle.click();
        await expect(header.userMenu).toBeVisible();
        await header.mobileToggle.click();
        await expect(header.userMenu).toBeHidden();
      });

      test('TC_DASHBOARD_041 | Layout adapts when the device is rotated', async ({ page, request }) => {
        await loginViaApi(page, request, env.customer);
        const account = new AccountPage(page);
        await account.goto();

        for (const viewport of [
          { width: 375, height: 812 },
          { width: 812, height: 375 },
          { width: 375, height: 812 },
        ]) {
          await page.setViewportSize(viewport);
          await expect(account.pageTitle).toBeVisible();
          await expect(account.invoicesTile).toBeInViewport();
          expect(await hasHorizontalScroll(page), `no overflow at ${viewport.width}x${viewport.height}`).toBe(false);
        }
      });
    });

    test.describe('tablet', () => {
      test.use({ viewport: { width: 768, height: 1024 } });

      test('TC_DASHBOARD_038 | Dashboard layout on tablet width', async ({ page, request }) => {
        await loginViaApi(page, request, env.admin);
        const dashboard = new AdminDashboardPage(page);

        await openDashboard(page);
        await expect(dashboard.salesChart).toBeVisible();
        await expect(dashboard.latestOrdersRows.first()).toBeVisible();

        const chart = await dashboard.salesChart.boundingBox();
        expect(chart!.x).toBeGreaterThanOrEqual(0);
        expect(chart!.x + chart!.width, 'chart is not cut off').toBeLessThanOrEqual(768);
        expect(await hasHorizontalScroll(page), 'no horizontal scrolling').toBe(false);
      });
    });

    test.describe('desktop', () => {
      test.use({ viewport: { width: 1920, height: 1080 } });

      test('TC_DASHBOARD_039 | Dashboard layout on desktop width', async ({ page, request }) => {
        await loginViaApi(page, request, env.admin);
        const dashboard = new AdminDashboardPage(page);

        await openDashboard(page);
        await expect(dashboard.salesChart).toBeVisible();
        await expect(dashboard.latestOrdersRows.first()).toBeVisible();

        const chart = await dashboard.salesChart.boundingBox();
        expect(chart!.width, 'chart uses the available width').toBeGreaterThanOrEqual(1920 * 0.5);
        expect(chart!.x + chart!.width).toBeLessThanOrEqual(1920);
        expect(await hasHorizontalScroll(page), 'no horizontal scrolling').toBe(false);
      });
    });
  });

  test.describe('Permission-based visibility', () => {
    test('TC_DASHBOARD_042 | Customer cannot open the admin dashboard', async ({ page, request }) => {
      await loginViaApi(page, request, env.customer);
      const reports: number[] = [];
      page.on('response', (r) => {
        if (r.url().includes('/reports/')) reports.push(r.status());
      });

      await new AdminDashboardPage(page).goto();

      await expect(page).not.toHaveURL(/\/admin\//);
      await expect(page.getByRole('heading', { name: 'Sales over the years' })).toBeHidden();
      expect(reports.filter((status) => status === 200), 'no admin report data loaded').toEqual([]);
    });

    test('TC_DASHBOARD_043 | Guest is redirected to login for protected pages', async ({ page }) => {
      await new AccountPage(page).goto();
      await expect(page).toHaveURL(/\/auth\/login$/);

      await new AdminDashboardPage(page).goto();
      await expect(page).toHaveURL(/\/auth\/login$/);
    });

    test('TC_DASHBOARD_044 | Admin menu items are shown only to admins', async ({ browser, request }) => {
      const adminContext = await browser.newContext({ baseURL: env.baseUrl });
      const adminPage = await adminContext.newPage();
      await loginViaApi(adminPage, request, env.admin);
      await openDashboard(adminPage);
      const adminHeader = new Header(adminPage);
      await adminHeader.openUserMenu();
      for (const item of ['Dashboard', 'Brands', 'Categories', 'Products', 'Orders', 'Users', 'Messages', 'Reports']) {
        await expect(adminHeader.userMenuEntry(item), `admin sees "${item}"`).toBeVisible();
      }
      await adminContext.close();

      const customerContext = await browser.newContext({ baseURL: env.baseUrl });
      const customerPage = await customerContext.newPage();
      await loginViaApi(customerPage, request, env.customer);
      const account = new AccountPage(customerPage);
      await account.goto();
      await expect(account.pageTitle).toHaveText('My account');
      const customerHeader = new Header(customerPage);
      await customerHeader.openUserMenu();
      for (const item of [
        customerHeader.myAccount,
        customerHeader.myFavorites,
        customerHeader.myProfile,
        customerHeader.myInvoices,
        customerHeader.myMessages,
      ]) {
        await expect(item).toBeVisible();
      }
      await expect(customerHeader.adminItems, 'customer sees no admin items').toHaveCount(0);
      await customerContext.close();
    });

    test("TC_DASHBOARD_045 | Customer cannot view another customer's invoice", async ({ page, request }) => {
      // The "other customer" is a fresh user, so no demo account gets a new order.
      const order = await placeOrder(request, await createTestUser(request));
      await loginViaApi(page, request, env.customer);
      const detail = new InvoiceDetailPage(page);

      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.request().method() === 'GET' && r.url() === `${env.apiUrl}/invoices/${order.id}`,
        ),
        detail.goto(order.id),
      ]);

      expect([403, 404], 'API refuses the other customer\'s invoice').toContain(response.status());
      // The field may not be rendered at all, so read it once instead of a `not` assertion.
      const shown = (await detail.invoiceNumber.count()) ? await detail.invoiceNumber.inputValue() : '';
      expect(shown, 'other customer\'s invoice number is not shown').not.toBe(order.invoice_number);
      await expect(page.getByText(order.invoice_number)).toHaveCount(0);
    });
  });
});
