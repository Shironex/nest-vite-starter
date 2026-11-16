import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CalendarClock } from 'lucide-react';

import { StatTile } from './stat-tile';

function getTile() {
  return screen.getByRole('group');
}

describe('StatTile', () => {
  it('renders the label and the figure', () => {
    render(<StatTile label="Active members" value={94} />);

    expect(screen.getByText('Active members')).toBeInTheDocument();
    expect(screen.getByText('94')).toBeInTheDocument();
  });

  it('names the group with its label', () => {
    render(<StatTile label="Active members" value={94} />);

    expect(getTile()).toHaveAccessibleName('Active members');
  });

  // The state that usually disappears, because `{count && ...}` hides it.
  it('renders a zero count rather than dropping the figure', () => {
    render(<StatTile label="Overdue" value={0} />);

    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('keeps the default tone for a zero count, since whether zero is good news is the consumer call', () => {
    render(<StatTile label="Overdue" value={0} />);

    expect(getTile()).toHaveAttribute('data-tone', 'default');
    expect(screen.getByText('0')).toHaveClass('text-text');
  });

  it.each([
    ['default', 'text-text'],
    ['warning', 'text-warning'],
    ['danger', 'text-danger'],
  ] as const)('colors the figure for the %s tone', (tone, expected) => {
    render(<StatTile label="Overdue" value={2} tone={tone} />);

    const figure = screen.getByText('2');
    expect(figure).toHaveClass('type-stat-figure');
    expect(figure).toHaveClass(expected);
  });

  it('sets the figure in the stat figure utility, not in a display style', () => {
    render(<StatTile label="Active members" value={94} />);

    const figure = screen.getByText('94');
    expect(figure).toHaveClass('type-stat-figure');
    expect(figure).not.toHaveClass('type-display-large');
  });

  describe('loading', () => {
    it('replaces the figure with a skeleton', () => {
      const { container } = render(
        <StatTile label="Active members" value={94} loading icon={<CalendarClock />} />,
      );

      expect(screen.queryByText('94')).not.toBeInTheDocument();
      expect(container.querySelector('[data-slot="stat-tile-value-skeleton"]')).toBeInTheDocument();
    });

    // Hiding the label would drop the tile's accessible name for as long as the
    // query runs, so only the pending figure is skeletoned.
    it('keeps the label and its accessible name while pending', () => {
      render(<StatTile label="Active members" value={94} loading />);

      expect(screen.getByText('Active members')).toBeInTheDocument();
      expect(getTile()).toHaveAccessibleName('Active members');
    });

    it('marks the tile busy only while loading', () => {
      const { rerender } = render(<StatTile label="Overdue" value={2} loading />);
      expect(getTile()).toHaveAttribute('aria-busy', 'true');

      rerender(<StatTile label="Overdue" value={2} />);
      expect(getTile()).not.toHaveAttribute('aria-busy');
    });
  });

  describe('icon chip', () => {
    it('hides the chip from assistive tech, since the label already names the tile', () => {
      const { container } = render(
        <StatTile label="Upcoming deadlines" value={5} icon={<CalendarClock />} />,
      );

      expect(container.querySelector('[data-slot="stat-tile-icon"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
    });

    it('omits the chip entirely when no icon is given', () => {
      const { container } = render(<StatTile label="Upcoming" value={7} />);

      expect(container.querySelector('[data-slot="stat-tile-icon"]')).not.toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('renders a link passed into the slot', () => {
      render(
        <StatTile
          label="Upcoming deadlines"
          value={5}
          footer={<a href="#agenda">Open agenda</a>}
        />,
      );

      expect(screen.getByRole('link', { name: 'Open agenda' })).toBeInTheDocument();
    });

    it('omits the footer entirely when no slot content is given', () => {
      const { container } = render(<StatTile label="Upcoming" value={7} />);

      expect(container.querySelector('[data-slot="stat-tile-footer"]')).not.toBeInTheDocument();
    });
  });

  it('merges a consumer className over the card chrome', () => {
    render(<StatTile label="Upcoming" value={7} className="p-2" />);

    // twMerge must drop the tile's own p-4.5 rather than emit both.
    expect(getTile()).toHaveClass('p-2');
    expect(getTile()).not.toHaveClass('p-4.5');
  });
});
