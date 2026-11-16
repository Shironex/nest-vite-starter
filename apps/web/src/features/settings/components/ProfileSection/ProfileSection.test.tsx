import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ProfileSection from './ProfileSection';

vi.mock('./ProfileSection.hooks', () => ({
  useProfileSection: () => ({
    displayName: 'Jane Doe',
    email: 'jane@example.com',
    role: 'admin',
    emailVerified: true,
    initials: 'JD',
  }),
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

  it('renders the initials avatar', () => {
    render(<ProfileSection />);
    expect(screen.getByText('JD')).toBeInTheDocument();
  });
});
