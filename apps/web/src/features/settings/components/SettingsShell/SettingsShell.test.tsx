import { fireEvent, render, screen } from '@testing-library/react';
import { Shield, User, Users } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import SettingsShell from './SettingsShell';
import type { ISettingsSection } from './SettingsShell.types';

const SECTIONS: ISettingsSection[] = [
  { id: 'profile', label: 'Profile', icon: User, panel: <p>Profile panel</p> },
  { id: 'security', label: 'Security', icon: Shield, panel: <p>Security panel</p> },
  { id: 'members', label: 'Members', icon: Users, panel: <p>Members panel</p> },
];

describe('SettingsShell', () => {
  it('opens the first section and marks its row current', () => {
    render(<SettingsShell sections={SECTIONS} />);

    expect(screen.getByText('Profile panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Security' })).not.toHaveAttribute('aria-current');
  });

  /*
   * A deep link (`/settings?section=...`) names a specific section, so the
   * route can ask for that section to open first.
   */
  it('opens the requested initial section instead of the first row', () => {
    render(<SettingsShell sections={SECTIONS} initialSectionId="security" />);

    expect(screen.getByText('Security panel')).toBeInTheDocument();
    expect(screen.queryByText('Profile panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Security' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  /*
   * The grace banner is shown on /settings too, so its deep link to the
   * security row can arrive while the shell is already mounted. The route
   * strips the consumed param (back to undefined), which must not move the
   * rail, and a later request must win again even after a manual switch.
   */
  it('follows a changed initial section while mounted', () => {
    const { rerender } = render(<SettingsShell sections={SECTIONS} />);
    expect(screen.getByText('Profile panel')).toBeInTheDocument();

    rerender(<SettingsShell sections={SECTIONS} initialSectionId="security" />);
    expect(screen.getByText('Security panel')).toBeInTheDocument();

    rerender(<SettingsShell sections={SECTIONS} initialSectionId={undefined} />);
    expect(screen.getByText('Security panel')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(screen.getByText('Profile panel')).toBeInTheDocument();

    rerender(<SettingsShell sections={SECTIONS} initialSectionId="security" />);
    expect(screen.getByText('Security panel')).toBeInTheDocument();
    expect(screen.queryByText('Profile panel')).not.toBeInTheDocument();
  });

  it('keeps a manual selection while the initial section is unchanged', () => {
    const { rerender } = render(<SettingsShell sections={SECTIONS} initialSectionId="security" />);

    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    rerender(<SettingsShell sections={SECTIONS} initialSectionId="security" />);

    expect(screen.getByText('Members panel')).toBeInTheDocument();
  });

  it('mounts only the selected panel', () => {
    render(<SettingsShell sections={SECTIONS} />);

    expect(screen.queryByText('Security panel')).not.toBeInTheDocument();
    expect(screen.queryByText('Members panel')).not.toBeInTheDocument();
  });

  it('swaps the panel when another row is pressed', () => {
    render(<SettingsShell sections={SECTIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Security' }));

    expect(screen.getByText('Security panel')).toBeInTheDocument();
    expect(screen.queryByText('Profile panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Security' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  /*
   * The admin-only row arrives after the first render, so a
   * selection can outlive the row that produced it. Falling back to the first
   * row is what keeps the panel area from going blank.
   */
  it('falls back to the first row when the selected section disappears', () => {
    const { rerender } = render(<SettingsShell sections={SECTIONS} />);

    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(screen.getByText('Members panel')).toBeInTheDocument();

    rerender(<SettingsShell sections={SECTIONS.slice(0, 2)} />);

    expect(screen.getByText('Profile panel')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
  });

  it('renders nothing when there is no section to show', () => {
    const { container } = render(<SettingsShell sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
