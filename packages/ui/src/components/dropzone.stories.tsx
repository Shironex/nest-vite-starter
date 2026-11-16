import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { Dropzone, FileList } from './dropzone';

const meta = {
  title: 'Components/Dropzone',
  component: Dropzone,
  tags: ['autodocs'],
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => {
    const [files, setFiles] = React.useState<Array<{ file: File; preview: string }>>([]);

    const handleFilesSelected = (selectedFiles: File[]) => {
      const newFiles = selectedFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    };

    const handleRemove = (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
      <div className="space-y-4">
        <Dropzone onFilesSelected={handleFilesSelected} />
        <FileList files={files} onRemove={handleRemove} />
      </div>
    );
  },
};

export const ImagesOnly: Story = {
  render: () => {
    const [files, setFiles] = React.useState<Array<{ file: File; preview: string }>>([]);

    const handleFilesSelected = (selectedFiles: File[]) => {
      const newFiles = selectedFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    };

    const handleRemove = (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
      <div className="space-y-4">
        <Dropzone
          onFilesSelected={handleFilesSelected}
          accept={{ 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] }}
        />
        <FileList files={files} onRemove={handleRemove} />
      </div>
    );
  },
};

export const WithMaxFiles: Story = {
  render: () => {
    const [files, setFiles] = React.useState<Array<{ file: File; preview: string }>>([]);

    const handleFilesSelected = (selectedFiles: File[]) => {
      const newFiles = selectedFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    };

    const handleRemove = (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
      <div className="space-y-4">
        <Dropzone onFilesSelected={handleFilesSelected} maxFiles={3} />
        <p className="text-sm text-muted-foreground">Max 3 files allowed</p>
        <FileList files={files} onRemove={handleRemove} />
      </div>
    );
  },
};

export const WithFileList: Story = {
  render: () => {
    const [files, setFiles] = React.useState<Array<{ file: File; preview: string }>>([
      {
        file: new File(['content'], 'budget-2026.xlsx', { type: 'application/vnd.ms-excel' }),
        preview: '',
      },
      {
        file: new File(['content'], 'project-plan.pdf', { type: 'application/pdf' }),
        preview: '',
      },
      {
        file: new File(['content'], 'team-handbook.docx', {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
        preview: '',
      },
    ]);

    const handleFilesSelected = (selectedFiles: File[]) => {
      const newFiles = selectedFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      setFiles((prev) => [...prev, ...newFiles]);
    };

    const handleRemove = (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    return (
      <div className="space-y-4">
        <Dropzone onFilesSelected={handleFilesSelected} />
        <div>
          <h3 className="mb-2 text-sm font-semibold">Uploaded Documents</h3>
          <FileList files={files} onRemove={handleRemove} />
        </div>
      </div>
    );
  },
};
