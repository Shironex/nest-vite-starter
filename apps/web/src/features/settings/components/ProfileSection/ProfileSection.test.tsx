import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProfileSection from './ProfileSection';

const state = vi.hoisted(() => ({
  avatarLoading: false,
  avatarError: false,
}));

vi.mock('./ProfileSection.hooks', () => ({
  useProfileSection: () => ({
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    role: 'admin',
    emailVerified: true,
    initials: 'JD',
    displayAvatarUrl: undefined,
    avatarLoading: state.avatarLoading,
    avatarError: state.avatarError,
    onUploadComplete: vi.fn(),
    onUploadError: vi.fn(),
  }),
}));

// Avoid FileUploadZone's mutation and XHR in tests.
vi.mock('@/features/shared/components/FileUploadZone', () => ({
  FileUploadZone: () => null,
}));

describe('ProfileSection', () => {
  it('renders the display name', () => {
    render(<ProfileSection />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('renders the email address', () => {
    render(<ProfileSection />);
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('shows the Verified badge when emailVerified is true', () => {
    render(<ProfileSection />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('shows the role in the card', () => {
    render(<ProfileSection />);
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('hides the initials while the avatar URL is loading', () => {
    state.avatarLoading = true;
    render(<ProfileSection />);
    expect(screen.queryByText('JD')).not.toBeInTheDocument();
    state.avatarLoading = false;
  });

  it('falls back to initials when the avatar URL lookup fails', () => {
    state.avatarError = true;
    render(<ProfileSection />);
    expect(screen.getByText('JD')).toBeInTheDocument();
    state.avatarError = false;
  });
});
