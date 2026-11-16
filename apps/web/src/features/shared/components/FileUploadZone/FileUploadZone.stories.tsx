import type { Meta, StoryObj } from '@storybook/react-vite';
import { MAX_FILE_SIZE } from '@repo/shared/constants';
import FileUploadZone from './FileUploadZone';

const meta: Meta<typeof FileUploadZone> = {
  title: 'shared/FileUploadZone',
  component: FileUploadZone,
  args: {
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE,
    accept: 'image/*',
    onUploadComplete: (_key: string, _url: string) => {},
    onUploadError: (_error: string) => {},
  },
};

export default meta;

type Story = StoryObj<typeof FileUploadZone>;

/** Default empty dropzone with no current image. */
export const Default: Story = {};

/** Dropzone showing a current avatar image with hover overlay. */
export const WithCurrentImage: Story = {
  args: {
    currentImageUrl: 'https://i.pravatar.cc/80',
  },
};

/** Multi-file variant (up to 5 files). */
export const MultiFile: Story = {
  args: {
    maxFiles: 5,
  },
};
