import type { Meta, StoryObj } from '@storybook/react-vite';
import AuthSubmit from './AuthSubmit';

const meta: Meta<typeof AuthSubmit> = {
  title: 'auth/AuthSubmit',
  component: AuthSubmit,
  args: { children: 'Sign in', isPending: false },
};

export default meta;

type Story = StoryObj<typeof AuthSubmit>;

export const Ready: Story = {};
export const VerifyingCaptcha: Story = { args: { captchaStatus: 'pending' } };
export const CaptchaFailed: Story = { args: { captchaStatus: 'error' } };
export const CaptchaExpired: Story = { args: { captchaStatus: 'expired' } };
export const Submitting: Story = { args: { isPending: true } };
