import type { Meta, StoryObj } from '@storybook/react-vite';
import { KanbanBoard } from './kanban';

const meta = {
  title: 'Components/Kanban',
  component: KanbanBoard,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => (
    <KanbanBoard
      columns={[
        {
          id: 'todo',
          title: 'To Do',
          cards: [
            {
              id: 'task-1',
              title: 'Design database schema',
              description: 'Create initial database design for new module',
              columnId: 'todo',
            },
            {
              id: 'task-2',
              title: 'API documentation',
              description: 'Write API endpoint documentation',
              columnId: 'todo',
            },
            {
              id: 'task-3',
              title: 'Setup CI/CD pipeline',
              columnId: 'todo',
            },
          ],
        },
        {
          id: 'in-progress',
          title: 'In Progress',
          cards: [
            {
              id: 'task-4',
              title: 'Implement authentication',
              description: 'Add JWT token authentication',
              columnId: 'in-progress',
            },
            {
              id: 'task-5',
              title: 'Build dashboard UI',
              columnId: 'in-progress',
            },
          ],
        },
        {
          id: 'done',
          title: 'Done',
          cards: [
            {
              id: 'task-6',
              title: 'Project kickoff',
              description: 'Initial project planning and scope',
              columnId: 'done',
            },
            {
              id: 'task-7',
              title: 'Environment setup',
              columnId: 'done',
            },
            {
              id: 'task-8',
              title: 'Team onboarding',
              columnId: 'done',
            },
          ],
        },
      ]}
    />
  ),
};

export const ProjectBoard: Story = {
  render: () => (
    <KanbanBoard
      columns={[
        {
          id: 'backlog',
          title: 'Backlog',
          cards: [
            {
              id: 'feat-1',
              title: 'Advanced reporting',
              description: 'Generate custom reports with filters',
              columnId: 'backlog',
            },
            {
              id: 'feat-2',
              title: 'Mobile app version',
              description: 'Develop React Native mobile application',
              columnId: 'backlog',
            },
            {
              id: 'feat-3',
              title: 'Data export to Excel',
              columnId: 'backlog',
            },
            {
              id: 'feat-4',
              title: 'Email notifications',
              description: 'Send alerts via email to users',
              columnId: 'backlog',
            },
          ],
        },
        {
          id: 'todo',
          title: 'To Do',
          cards: [
            {
              id: 'feat-5',
              title: 'User role management',
              description: 'Create role-based access control system',
              columnId: 'todo',
            },
            {
              id: 'feat-6',
              title: 'Audit logging',
              description: 'Track all user actions in system',
              columnId: 'todo',
            },
          ],
        },
        {
          id: 'in-progress',
          title: 'In Progress',
          cards: [
            {
              id: 'feat-7',
              title: 'Performance optimization',
              description: 'Improve query execution time',
              columnId: 'in-progress',
            },
            {
              id: 'feat-8',
              title: 'Security audit',
              description: 'Conduct comprehensive security review',
              columnId: 'in-progress',
            },
          ],
        },
        {
          id: 'review',
          title: 'Review',
          cards: [
            {
              id: 'feat-9',
              title: 'Data migration tool',
              description: 'Tool to migrate data from legacy system',
              columnId: 'review',
            },
          ],
        },
      ]}
    />
  ),
};

export const OrderPipeline: Story = {
  render: () => (
    <KanbanBoard
      columns={[
        {
          id: 'new',
          title: 'New',
          cards: [
            {
              id: 'order-1',
              title: 'Order #ORD-2024-501',
              description: 'Customer: Northwind Corp - $5,200',
              columnId: 'new',
            },
            {
              id: 'order-2',
              title: 'Order #ORD-2024-502',
              description: 'Customer: TechStart Inc - $8,500',
              columnId: 'new',
            },
            {
              id: 'order-3',
              title: 'Order #ORD-2024-503',
              description: 'Customer: Global Solutions - $3,200',
              columnId: 'new',
            },
          ],
        },
        {
          id: 'processing',
          title: 'Processing',
          cards: [
            {
              id: 'order-4',
              title: 'Order #ORD-2024-498',
              description: 'Customer: NextGen Ltd - $12,000',
              columnId: 'processing',
            },
            {
              id: 'order-5',
              title: 'Order #ORD-2024-499',
              description: 'Customer: Innovation Labs - $6,750',
              columnId: 'processing',
            },
          ],
        },
        {
          id: 'shipped',
          title: 'Shipped',
          cards: [
            {
              id: 'order-6',
              title: 'Order #ORD-2024-495',
              description: 'Customer: Digital Dynamics - $4,200',
              columnId: 'shipped',
            },
            {
              id: 'order-7',
              title: 'Order #ORD-2024-496',
              description: 'Customer: Premier Tech - $9,800',
              columnId: 'shipped',
            },
            {
              id: 'order-8',
              title: 'Order #ORD-2024-497',
              description: 'Customer: Enterprise Systems - $15,500',
              columnId: 'shipped',
            },
          ],
        },
        {
          id: 'delivered',
          title: 'Delivered',
          cards: [
            {
              id: 'order-9',
              title: 'Order #ORD-2024-490',
              description: 'Customer: Smart Industries - $7,200',
              columnId: 'delivered',
            },
            {
              id: 'order-10',
              title: 'Order #ORD-2024-491',
              description: 'Customer: Cloud Services - $11,200',
              columnId: 'delivered',
            },
            {
              id: 'order-11',
              title: 'Order #ORD-2024-492',
              description: 'Customer: DataFlow Corp - $8,900',
              columnId: 'delivered',
            },
            {
              id: 'order-12',
              title: 'Order #ORD-2024-493',
              description: 'Customer: Quantum Solutions - $13,500',
              columnId: 'delivered',
            },
          ],
        },
      ]}
    />
  ),
};
