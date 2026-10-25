import type { Locator, Page } from '@playwright/test';

/** Top navigation bar, shared by every page. */
export class Header {
  readonly signIn: Locator;
  readonly userMenu: Locator;
  /** Hamburger button shown on narrow screens; the app gives it no data-test attribute. */
  readonly mobileToggle: Locator;
  readonly myAccount: Locator;
  readonly myFavorites: Locator;
  readonly myProfile: Locator;
  readonly myInvoices: Locator;
  readonly myMessages: Locator;
  readonly signOut: Locator;
  /** Every admin-only item in the user menu (data-test="nav-admin-*"). */
  readonly adminItems: Locator;
  /** Top-level entries of the open user menu; some (e.g. "Reports") have no data-test attribute. */
  readonly userMenuEntries: Locator;

  constructor(readonly page: Page) {
    this.signIn = page.getByTestId('nav-sign-in');
    this.userMenu = page.getByTestId('nav-menu');
    this.mobileToggle = page.getByRole('button', { name: 'Toggle navigation' });
    this.myAccount = page.getByTestId('nav-my-account');
    this.myFavorites = page.getByTestId('nav-my-favorites');
    this.myProfile = page.getByTestId('nav-my-profile');
    this.myInvoices = page.getByTestId('nav-my-invoices');
    this.myMessages = page.getByTestId('nav-my-messages');
    this.signOut = page.getByTestId('nav-sign-out');
    this.adminItems = page.locator('[data-test^="nav-admin-"]');
    this.userMenuEntries = page.getByRole('menuitem').filter({ has: this.userMenu }).getByRole('listitem');
  }

  /** One user menu entry (a link, or a button that opens a submenu), matched by its exact label. */
  userMenuEntry(label: string): Locator {
    return this.userMenuEntries
      .getByRole('link', { name: label, exact: true })
      .or(this.userMenuEntries.getByRole('button', { name: label, exact: true }));
  }

  async openUserMenu(): Promise<void> {
    await this.userMenu.click();
  }

  async logout(): Promise<void> {
    await this.openUserMenu();
    await this.signOut.click();
  }
}

/** Customer "My account" page (/account). */
export class AccountPage {
  readonly pageTitle: Locator;
  readonly favoritesTile: Locator;
  readonly profileTile: Locator;
  readonly invoicesTile: Locator;
  readonly messagesTile: Locator;

  constructor(readonly page: Page) {
    this.pageTitle = page.getByTestId('page-title');
    this.favoritesTile = page.getByTestId('nav-favorites');
    this.profileTile = page.getByTestId('nav-profile');
    this.invoicesTile = page.getByTestId('nav-invoices');
    this.messagesTile = page.getByTestId('nav-messages');
  }

  async goto(): Promise<void> {
    await this.page.goto('/account');
  }
}

/** Customer invoice list (/account/invoices). */
export class InvoicesPage {
  readonly pageTitle: Locator;
  readonly rows: Locator;

  constructor(readonly page: Page) {
    this.pageTitle = page.getByTestId('page-title');
    this.rows = page.locator('table tbody tr');
  }

  async goto(): Promise<void> {
    await this.page.goto('/account/invoices');
  }

  /** "Details" link of a row; the app renders it without a data-test attribute. */
  detailsLink(row: Locator): Locator {
    return row.getByRole('link', { name: 'Details' });
  }
}

/** Customer invoice detail (/account/invoices/:id). */
export class InvoiceDetailPage {
  readonly invoiceNumber: Locator;
  readonly total: Locator;

  constructor(readonly page: Page) {
    this.invoiceNumber = page.getByTestId('invoice-number');
    this.total = page.getByTestId('total');
  }

  async goto(id: string): Promise<void> {
    await this.page.goto(`/account/invoices/${id}`);
  }
}

/** Customer profile (/account/profile). */
export class ProfilePage {
  readonly pageTitle: Locator;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly email: Locator;
  readonly phone: Locator;
  readonly street: Locator;
  readonly postalCode: Locator;
  readonly city: Locator;
  readonly state: Locator;
  readonly country: Locator;

  constructor(readonly page: Page) {
    this.pageTitle = page.getByTestId('page-title');
    this.firstName = page.getByTestId('first-name');
    this.lastName = page.getByTestId('last-name');
    this.email = page.getByTestId('email');
    this.phone = page.getByTestId('phone');
    this.street = page.getByTestId('street');
    this.postalCode = page.getByTestId('postal_code');
    this.city = page.getByTestId('city');
    this.state = page.getByTestId('state');
    this.country = page.getByTestId('country');
  }

  async goto(): Promise<void> {
    await this.page.goto('/account/profile');
  }
}

/** Admin landing page (/admin/dashboard): sales chart and latest orders table. */
export class AdminDashboardPage {
  readonly pageTitle: Locator;
  /** Chart.js canvas; the app gives it no data-test attribute. */
  readonly salesChart: Locator;
  readonly latestOrdersHeading: Locator;
  readonly latestOrdersRows: Locator;

  constructor(readonly page: Page) {
    this.pageTitle = page.getByTestId('page-title');
    this.salesChart = page.locator('canvas.chart');
    this.latestOrdersHeading = page.getByRole('heading', { name: 'Latest orders' });
    this.latestOrdersRows = page.locator('table tbody tr');
  }

  async goto(): Promise<void> {
    await this.page.goto('/admin/dashboard');
  }
}
