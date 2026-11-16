import { PRODUCT_NAME } from '@repo/shared/constants';
import { test, expect } from './support/render-only';

test.describe('Landing page', () => {
  test('is titled with the product name', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(PRODUCT_NAME);
  });

  test('names the product in its only h1', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PRODUCT_NAME);
  });

  // The landing page deliberately ships without a theme toggle. The toggle
  // lives in Settings for signed-in users.
  test('offers no theme toggle', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /toggle theme/i })).toHaveCount(0);
  });

  test('carries no marketing sections', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2 })).toHaveCount(0);
  });

  test('leads to sign in from the header', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('leads to account creation from the header', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('banner').getByRole('link', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('leads to account creation from the hero', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});
