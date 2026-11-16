import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tree } from './tree';
import type { ITreeNode } from './tree';
import { FolderIcon, FileIcon, Building2Icon, Package2Icon, Layers3Icon } from 'lucide-react';

const meta = {
  title: 'Components/Tree',
  component: Tree,
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => {
    const departmentHierarchy: ITreeNode[] = [
      {
        id: 'exec',
        label: 'Executive Board',
        icon: <Building2Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'ceo',
            label: 'CEO - Chief Executive Officer',
            children: [],
          },
          {
            id: 'cfo',
            label: 'CFO - Chief Financial Officer',
            children: [],
          },
          {
            id: 'cto',
            label: 'CTO - Chief Technology Officer',
            children: [],
          },
        ],
      },
      {
        id: 'engineering',
        label: 'Engineering Department',
        icon: <Building2Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'backend',
            label: 'Backend Team',
            children: [
              {
                id: 'backend-lead',
                label: 'Team Lead - Backend',
              },
              {
                id: 'backend-eng1',
                label: 'Senior Engineer',
              },
              {
                id: 'backend-eng2',
                label: 'Engineer',
              },
            ],
          },
          {
            id: 'frontend',
            label: 'Frontend Team',
            children: [
              {
                id: 'frontend-lead',
                label: 'Team Lead - Frontend',
              },
              {
                id: 'frontend-eng1',
                label: 'Senior Engineer',
              },
            ],
          },
          {
            id: 'devops',
            label: 'DevOps Team',
            children: [
              {
                id: 'devops-lead',
                label: 'DevOps Lead',
              },
            ],
          },
        ],
      },
      {
        id: 'sales',
        label: 'Sales Department',
        icon: <Building2Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'sales-lead',
            label: 'Sales Director',
          },
          {
            id: 'sales-team',
            label: 'Sales Team',
            children: [
              {
                id: 'sales-rep1',
                label: 'Account Executive',
              },
              {
                id: 'sales-rep2',
                label: 'Account Executive',
              },
            ],
          },
        ],
      },
    ];

    return <Tree nodes={departmentHierarchy} initialExpandedIds={['exec', 'engineering']} />;
  },
};

export const FileSystem: Story = {
  render: () => {
    const fileSystem: ITreeNode[] = [
      {
        id: 'root',
        label: 'Project Root',
        isFolder: true,
        icon: <FolderIcon className="h-4 w-4" />,
        children: [
          {
            id: 'src',
            label: 'src',
            isFolder: true,
            icon: <FolderIcon className="h-4 w-4" />,
            children: [
              {
                id: 'src-components',
                label: 'components',
                isFolder: true,
                icon: <FolderIcon className="h-4 w-4" />,
                children: [
                  {
                    id: 'button-tsx',
                    label: 'button.tsx',
                    icon: <FileIcon className="h-4 w-4" />,
                  },
                  {
                    id: 'card-tsx',
                    label: 'card.tsx',
                    icon: <FileIcon className="h-4 w-4" />,
                  },
                  {
                    id: 'dialog-tsx',
                    label: 'dialog.tsx',
                    icon: <FileIcon className="h-4 w-4" />,
                  },
                ],
              },
              {
                id: 'src-lib',
                label: 'lib',
                isFolder: true,
                icon: <FolderIcon className="h-4 w-4" />,
                children: [
                  {
                    id: 'utils-ts',
                    label: 'utils.ts',
                    icon: <FileIcon className="h-4 w-4" />,
                  },
                  {
                    id: 'constants-ts',
                    label: 'constants.ts',
                    icon: <FileIcon className="h-4 w-4" />,
                  },
                ],
              },
              {
                id: 'app-tsx',
                label: 'App.tsx',
                icon: <FileIcon className="h-4 w-4" />,
              },
              {
                id: 'main-tsx',
                label: 'main.tsx',
                icon: <FileIcon className="h-4 w-4" />,
              },
            ],
          },
          {
            id: 'public',
            label: 'public',
            isFolder: true,
            icon: <FolderIcon className="h-4 w-4" />,
            children: [
              {
                id: 'favicon',
                label: 'favicon.ico',
                icon: <FileIcon className="h-4 w-4" />,
              },
            ],
          },
          {
            id: 'package-json',
            label: 'package.json',
            icon: <FileIcon className="h-4 w-4" />,
          },
          {
            id: 'tsconfig',
            label: 'tsconfig.json',
            icon: <FileIcon className="h-4 w-4" />,
          },
          {
            id: 'vite-config',
            label: 'vite.config.ts',
            icon: <FileIcon className="h-4 w-4" />,
          },
        ],
      },
    ];

    return <Tree nodes={fileSystem} initialExpandedIds={['root', 'src', 'src-components']} />;
  },
};

export const ProductCategories: Story = {
  render: () => {
    const productCategories: ITreeNode[] = [
      {
        id: 'electronics',
        label: 'Electronics',
        icon: <Layers3Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'computers',
            label: 'Computers',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'laptops',
                label: 'Laptops',
              },
              {
                id: 'desktops',
                label: 'Desktop PCs',
              },
              {
                id: 'tablets',
                label: 'Tablets',
              },
            ],
          },
          {
            id: 'phones',
            label: 'Mobile Phones',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'smartphones',
                label: 'Smartphones',
              },
              {
                id: 'accessories',
                label: 'Phone Accessories',
              },
            ],
          },
          {
            id: 'audio',
            label: 'Audio Equipment',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'headphones',
                label: 'Headphones',
              },
              {
                id: 'speakers',
                label: 'Speakers',
              },
              {
                id: 'microphones',
                label: 'Microphones',
              },
            ],
          },
        ],
      },
      {
        id: 'furniture',
        label: 'Furniture',
        icon: <Layers3Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'office',
            label: 'Office Furniture',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'desks',
                label: 'Desks',
              },
              {
                id: 'chairs',
                label: 'Office Chairs',
              },
              {
                id: 'cabinets',
                label: 'Storage Cabinets',
              },
            ],
          },
          {
            id: 'home',
            label: 'Home Furniture',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'sofas',
                label: 'Sofas',
              },
              {
                id: 'dining',
                label: 'Dining Tables',
              },
              {
                id: 'beds',
                label: 'Beds',
              },
            ],
          },
        ],
      },
      {
        id: 'clothing',
        label: 'Clothing & Apparel',
        icon: <Layers3Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'mens',
            label: "Men's Clothing",
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'shirts',
                label: 'Shirts & Tops',
              },
              {
                id: 'pants',
                label: 'Pants & Jeans',
              },
              {
                id: 'jackets',
                label: 'Jackets & Coats',
              },
            ],
          },
          {
            id: 'womens',
            label: "Women's Clothing",
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'dresses',
                label: 'Dresses',
              },
              {
                id: 'blouses',
                label: 'Blouses',
              },
              {
                id: 'skirts',
                label: 'Skirts',
              },
            ],
          },
        ],
      },
    ];

    return (
      <Tree
        nodes={productCategories}
        initialExpandedIds={['electronics', 'computers', 'furniture']}
      />
    );
  },
};

export const BillOfMaterials: Story = {
  render: () => {
    const bom: ITreeNode[] = [
      {
        id: 'product',
        label: 'Assembled Product - SKU: PROD-001',
        icon: <Package2Icon className="h-4 w-4" />,
        isFolder: true,
        children: [
          {
            id: 'chassis',
            label: 'Chassis Assembly',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'frame',
                label: 'Aluminum Frame - QTY: 1',
              },
              {
                id: 'screws',
                label: 'Stainless Steel Screws - QTY: 12',
              },
              {
                id: 'gasket',
                label: 'Rubber Gasket - QTY: 2',
              },
            ],
          },
          {
            id: 'electronics',
            label: 'Electronic Components',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'pcb',
                label: 'PCB Assembly - QTY: 1',
                isFolder: true,
                children: [
                  {
                    id: 'cpu',
                    label: 'Microcontroller (ARM Cortex) - QTY: 1',
                  },
                  {
                    id: 'capacitors',
                    label: 'Capacitors - QTY: 20',
                  },
                  {
                    id: 'resistors',
                    label: 'Resistors - QTY: 30',
                  },
                  {
                    id: 'leds',
                    label: 'Status LEDs - QTY: 3',
                  },
                ],
              },
              {
                id: 'power',
                label: 'Power Supply Unit - QTY: 1',
              },
              {
                id: 'wiring',
                label: 'Internal Wiring Harness - QTY: 1',
              },
            ],
          },
          {
            id: 'packaging',
            label: 'Packaging Components',
            isFolder: true,
            icon: <Package2Icon className="h-4 w-4" />,
            children: [
              {
                id: 'box',
                label: 'Cardboard Box - QTY: 1',
              },
              {
                id: 'foam',
                label: 'Protective Foam Padding - QTY: 1 set',
              },
              {
                id: 'manual',
                label: 'User Manual (Printed) - QTY: 1',
              },
              {
                id: 'label',
                label: 'Product Label - QTY: 1',
              },
            ],
          },
        ],
      },
    ];

    return <Tree nodes={bom} initialExpandedIds={['product', 'chassis', 'electronics', 'pcb']} />;
  },
};
