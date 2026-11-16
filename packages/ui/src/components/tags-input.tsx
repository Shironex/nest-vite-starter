'use client';

import * as React from 'react';
import { XIcon } from 'lucide-react';

import { cn } from '@repo/ui/lib/utils';
import { Badge } from './badge';

interface ITagsInputProps {
  value?: string[];
  onChange?: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  disabled?: boolean;
  className?: string;
  onTagAdd?: (tag: string) => void;
  onTagRemove?: (tag: string) => void;
}

interface ITagProps {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
}

const TagsInput = React.forwardRef<HTMLInputElement, ITagsInputProps>(
  (
    {
      value = [],
      onChange,
      placeholder = 'Add tags...',
      maxTags,
      disabled = false,
      className,
      onTagAdd,
      onTagRemove,
    },
    ref,
  ) => {
    const [inputValue, setInputValue] = React.useState('');
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    const handleAddTag = (tag: string) => {
      const trimmedTag = tag.trim();

      if (!trimmedTag) return;

      // Check for duplicates
      if (value.includes(trimmedTag)) return;

      // Check max tags
      if (maxTags && value.length >= maxTags) return;

      const newTags = [...value, trimmedTag];
      onChange?.(newTags);
      onTagAdd?.(trimmedTag);
      setInputValue('');
    };

    const handleRemoveTag = (tag: string) => {
      const newTags = value.filter((t) => t !== tag);
      onChange?.(newTags);
      onTagRemove?.(tag);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return;

      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        handleAddTag(inputValue);
      } else if (e.key === 'Backspace' && inputValue === '' && value.length > 0) {
        e.preventDefault();
        const lastTag = value[value.length - 1]!;
        handleRemoveTag(lastTag);
      }
    };

    return (
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
          className,
        )}
      >
        {value.map((tag) => (
          <Tag key={tag} label={tag} onRemove={() => handleRemoveTag(tag)} disabled={disabled} />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className={cn(
            'min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed',
            maxTags && value.length >= maxTags && 'hidden',
          )}
          data-slot="tags-input"
        />
      </div>
    );
  },
);

TagsInput.displayName = 'TagsInput';

const Tag = React.forwardRef<HTMLDivElement, ITagProps>(
  ({ label, onRemove, disabled = false }, ref) => {
    return (
      <div ref={ref} className="flex items-center gap-1">
        <Badge variant="secondary" className="pl-2">
          {label}
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="ml-1 rounded-full transition-colors hover:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
            aria-label={`Remove tag ${label}`}
          >
            <XIcon className="h-3 w-3" />
          </button>
        </Badge>
      </div>
    );
  },
);

Tag.displayName = 'Tag';

export { TagsInput, Tag, type ITagsInputProps };
