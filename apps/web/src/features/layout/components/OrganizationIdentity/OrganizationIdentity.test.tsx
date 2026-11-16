import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OrganizationIdentity from './OrganizationIdentity';
import type { OrganizationIdentityState } from './OrganizationIdentity.types';

const view: OrganizationIdentityState = { status: 'ready', name: 'Acme Robotics', initial: 'AR' };
const useOrganizationIdentity = vi.fn((): OrganizationIdentityState => view);

vi.mock('./OrganizationIdentity.hooks', () => ({
  useOrganizationIdentity: () => useOrganizationIdentity(),
}));

describe('OrganizationIdentity', () => {
  it('renders the organization name', () => {
    render(<OrganizationIdentity />);
    expect(screen.getByText('Acme Robotics')).toBeInTheDocument();
  });

  it('renders the initials in the avatar glyph', () => {
    render(<OrganizationIdentity />);
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  // The skeleton holds the footer's place so the sidebar's bottom edge does
  // not shift when the name lands.
  it('reserves the footer with a skeleton while the identity is pending', () => {
    useOrganizationIdentity.mockReturnValueOnce({ status: 'pending' });
    const { container } = render(<OrganizationIdentity />);

    const footer = container.querySelector('[data-slot="nav-rail-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('[data-slot="organization-identity-skeleton"]')).not.toBeNull();
    expect(footer?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    expect(screen.queryByText('Acme Robotics')).not.toBeInTheDocument();
  });

  it('renders the fallback name when the lookup failed', () => {
    useOrganizationIdentity.mockReturnValueOnce({
      status: 'error',
      name: 'Your organization',
      initial: 'TO',
    });
    render(<OrganizationIdentity />);

    expect(screen.getByText('Your organization')).toBeInTheDocument();
    expect(screen.getByText('TO')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="organization-identity-skeleton"]')).toBeNull();
  });

  // A label, not a control: no switcher, so no chevron, no button, and
  // nothing focusable to accidentally imply one.
  it('renders no interactive elements', () => {
    render(<OrganizationIdentity />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(document.querySelector('[tabindex]')).toBeNull();
  });
});
