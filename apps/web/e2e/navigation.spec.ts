import { test, expect } from './support/render-only';

test.describe('Navigation', () => {
  test('should show landing page with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('SaaS Starter');
  });

  test('should display hero section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /Ship the product/i })).toBeVisible();
  });

  // The Landing Split design has no theme-toggle affordance in its nav, so the
  // marketing page deliberately ships without one. The toggle still lives in
  // Settings for signed-in users.
  test('should not offer a theme toggle on the marketing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /toggle theme/i })).toHaveCount(0);
  });

  test('should have navigation links for unauthenticated users', async ({ page }) => {
    await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
    await expect(header.getByRole('link', { name: 'Sign up' }).first()).toBeVisible();
  });

  test('should navigate to login from landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Log in' }).first().click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('should navigate to register from landing page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Sign up' }).first().click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('should display features section', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { level: 2, name: /Everything a SaaS needs/i }),
    ).toBeVisible();
  });

  test('should expand a FAQ answer', async ({ page }) => {
    await page.goto('/');
    const question = page.getByRole('button', { name: /import data from another tool/i });
    await question.click();
    await expect(question).toHaveAttribute('aria-expanded', 'true');
  });
});
