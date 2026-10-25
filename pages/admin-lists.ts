import type { Locator, Page, Response } from '@playwright/test';

/** Shared parts of the admin list pages (search form, table, pagination). */
abstract class AdminListPage {
  abstract readonly searchQuery: Locator;
  abstract readonly searchSubmit: Locator;
  readonly pageTitle: Locator;
  readonly rows: Locator;

  constructor(
    readonly page: Page,
    private readonly searchApiPath: string,
  ) {
    this.pageTitle = page.getByTestId('page-title');
    this.rows = page.locator('table tbody tr');
  }

  /** Searches and returns the search API response. */
  async search(text: string): Promise<Response> {
    await this.searchQuery.fill(text);
    const [response] = await Promise.all([
      this.page.waitForResponse(
        (r) => r.request().method() !== 'OPTIONS' && r.url().includes(this.searchApiPath),
      ),
      this.searchSubmit.click(),
    ]);
    return response;
  }

  /** Pagination button for a page number; the buttons only have an aria-label. */
  pageButton(pageNumber: number): Locator {
    return this.page.getByRole('button', { name: `Page-${pageNumber}`, exact: true });
  }

  columnHeader(name: string): Locator {
    return this.page.getByRole('columnheader', { name, exact: true });
  }

  /** Text of one column for every visible row (1-based column index). */
  columnValues(column: number): Promise<string[]> {
    return this.rows.locator(`td:nth-child(${column})`).allInnerTexts();
  }
}

/** Admin > Orders (/admin/orders). */
export class AdminOrdersPage extends AdminListPage {
  readonly searchQuery: Locator;
  readonly searchSubmit: Locator;

  constructor(page: Page) {
    super(page, '/invoices/search');
    this.searchQuery = page.getByTestId('order-search-query');
    this.searchSubmit = page.getByTestId('order-search-submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/orders');
  }
}

/** Admin > Products (/admin/products). */
export class AdminProductsPage extends AdminListPage {
  readonly searchQuery: Locator;
  readonly searchSubmit: Locator;

  static readonly NAME_COLUMN = 2;
  static readonly PRICE_COLUMN = 4;

  constructor(page: Page) {
    super(page, '/products/search');
    this.searchQuery = page.getByTestId('product-search-query');
    this.searchSubmit = page.getByTestId('product-search-submit');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/products');
  }
}
