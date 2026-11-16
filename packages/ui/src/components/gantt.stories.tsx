import type { Meta, StoryObj } from '@storybook/react-vite';
import { GanttChart } from './gantt';
import { addDays, addWeeks, addMonths } from 'date-fns';

const meta = {
  title: 'Components/Gantt',
  component: GanttChart,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const today = new Date();
    return (
      <GanttChart
        tasks={[
          {
            id: '1',
            title: 'Project Planning',
            startDate: today,
            endDate: addDays(today, 4),
            progress: 100,
            category: 'Planning',
          },
          {
            id: '2',
            title: 'Design Phase',
            startDate: addDays(today, 4),
            endDate: addDays(today, 12),
            progress: 75,
            category: 'Design',
          },
          {
            id: '3',
            title: 'Development',
            startDate: addDays(today, 10),
            endDate: addDays(today, 25),
            progress: 50,
            category: 'Development',
          },
          {
            id: '4',
            title: 'Testing & QA',
            startDate: addDays(today, 24),
            endDate: addDays(today, 31),
            progress: 25,
            category: 'Testing',
          },
          {
            id: '5',
            title: 'Deployment',
            startDate: addDays(today, 31),
            endDate: addDays(today, 33),
            progress: 0,
            category: 'Deployment',
          },
          {
            id: '6',
            title: 'Launch',
            startDate: addDays(today, 33),
            endDate: addDays(today, 33),
            progress: 0,
            isMilestone: true,
            category: 'Milestone',
          },
        ]}
        startDate={today}
        endDate={addDays(today, 35)}
        viewMode="week"
      />
    );
  },
};

export const ProductionSchedule: Story = {
  render: () => {
    const today = new Date();
    return (
      <GanttChart
        tasks={[
          {
            id: 'ms1',
            title: 'Production Order Received',
            startDate: today,
            endDate: today,
            progress: 100,
            isMilestone: true,
            category: 'Milestone',
          },
          {
            id: 'raw',
            title: 'Raw Materials Procurement',
            startDate: today,
            endDate: addDays(today, 7),
            progress: 100,
            category: 'Procurement',
          },
          {
            id: 'setup',
            title: 'Equipment Setup & Calibration',
            startDate: addDays(today, 7),
            endDate: addDays(today, 9),
            progress: 100,
            category: 'Setup',
          },
          {
            id: 'prod',
            title: 'Manufacturing Production',
            startDate: addDays(today, 9),
            endDate: addDays(today, 21),
            progress: 60,
            category: 'Production',
          },
          {
            id: 'qa',
            title: 'Quality Inspection',
            startDate: addDays(today, 20),
            endDate: addDays(today, 23),
            progress: 40,
            category: 'Quality',
          },
          {
            id: 'pack',
            title: 'Packaging & Labeling',
            startDate: addDays(today, 23),
            endDate: addDays(today, 25),
            progress: 0,
            category: 'Packaging',
          },
          {
            id: 'ms2',
            title: 'Ready for Shipment',
            startDate: addDays(today, 25),
            endDate: addDays(today, 25),
            progress: 0,
            isMilestone: true,
            category: 'Milestone',
          },
          {
            id: 'ship',
            title: 'Delivery to Customer',
            startDate: addDays(today, 25),
            endDate: addDays(today, 28),
            progress: 0,
            category: 'Shipping',
          },
        ]}
        startDate={today}
        endDate={addDays(today, 30)}
        viewMode="week"
      />
    );
  },
};

export const WeekView: Story = {
  render: () => {
    const today = new Date();
    return (
      <GanttChart
        tasks={[
          {
            id: '1',
            title: 'Monday - Sprint Kickoff',
            startDate: today,
            endDate: today,
            progress: 100,
            category: 'Day 1',
          },
          {
            id: '2',
            title: 'Tuesday - Development',
            startDate: addDays(today, 1),
            endDate: addDays(today, 1),
            progress: 100,
            category: 'Day 2',
          },
          {
            id: '3',
            title: 'Wednesday - Code Review',
            startDate: addDays(today, 2),
            endDate: addDays(today, 2),
            progress: 80,
            category: 'Day 3',
          },
          {
            id: '4',
            title: 'Thursday - Testing',
            startDate: addDays(today, 3),
            endDate: addDays(today, 3),
            progress: 60,
            category: 'Day 4',
          },
          {
            id: '5',
            title: 'Friday - Deployment Prep',
            startDate: addDays(today, 4),
            endDate: addDays(today, 4),
            progress: 40,
            category: 'Day 5',
          },
          {
            id: '6',
            title: 'Weekend - Monitoring',
            startDate: addDays(today, 5),
            endDate: addDays(today, 6),
            progress: 0,
            category: 'Weekend',
          },
        ]}
        startDate={today}
        endDate={addDays(today, 7)}
        viewMode="day"
      />
    );
  },
};

export const MonthView: Story = {
  render: () => {
    const today = new Date();
    return (
      <GanttChart
        tasks={[
          {
            id: 'q1-1',
            title: 'Q1 Planning & Analysis',
            startDate: today,
            endDate: addWeeks(today, 3),
            progress: 100,
            category: 'Planning',
          },
          {
            id: 'q1-2',
            title: 'Q1 Design Phase',
            startDate: addWeeks(today, 2),
            endDate: addWeeks(today, 5),
            progress: 85,
            category: 'Design',
          },
          {
            id: 'q1-3',
            title: 'Q1 Development Sprint 1',
            startDate: addWeeks(today, 4),
            endDate: addWeeks(today, 6),
            progress: 70,
            category: 'Development',
          },
          {
            id: 'q1-4',
            title: 'Q1 Development Sprint 2',
            startDate: addWeeks(today, 6),
            endDate: addWeeks(today, 8),
            progress: 50,
            category: 'Development',
          },
          {
            id: 'q1-5',
            title: 'Q1 Testing & UAT',
            startDate: addWeeks(today, 8),
            endDate: addWeeks(today, 10),
            progress: 25,
            category: 'Testing',
          },
          {
            id: 'q1-6',
            title: 'Q1 Production Deployment',
            startDate: addWeeks(today, 10),
            endDate: addWeeks(today, 11),
            progress: 0,
            category: 'Deployment',
          },
          {
            id: 'q1-ms',
            title: 'Q1 Release',
            startDate: addWeeks(today, 11),
            endDate: addWeeks(today, 11),
            progress: 0,
            isMilestone: true,
            category: 'Milestone',
          },
          {
            id: 'q2-1',
            title: 'Q2 Maintenance & Support',
            startDate: addWeeks(today, 12),
            endDate: addMonths(today, 3),
            progress: 0,
            category: 'Support',
          },
        ]}
        startDate={today}
        endDate={addMonths(today, 3)}
        viewMode="month"
      />
    );
  },
};
