import { test, expect } from './support/render-only';

test.describe('Authentication', () => {
  test('should show login page with correct heading', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('should show login form fields', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('should show validation errors on empty submit', async ({ page }) => {
    await page.goto('/auth/login');

    // Focus and blur email to trigger onBlur validation
    await page.getByLabel('Email address').focus();
    await page.getByLabel('Password').focus();
    await page.getByLabel('Email address').focus();

    // Click submit to trigger remaining validations
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Expect validation error messages to appear (react-hook-form + zod)
    await expect(page.locator('form')).toContainText(/invalid|required/i);
  });

  test('should redirect unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('should show register page with correct heading', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.getByRole('heading', { name: 'Create an account' })).toBeVisible();
  });

  test('should show register form fields', async ({ page }) => {
    await page.goto('/auth/register');
    await expect(page.getByLabel('Work email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('should navigate from login to register', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('link', { name: 'Create an account' }).click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });

  test('should navigate from register to login', async ({ page }) => {
    await page.goto('/auth/register');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('should have a back to home link on login page', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('link', { name: 'Back to the home page' })).toBeVisible();
  });
});
