'use client';

import * as React from 'react';
import { useEditor, EditorContent as TiptapEditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder, CharacterCount } from '@tiptap/extensions';
import type { LucideIcon } from 'lucide-react';
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  StrikethroughIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  CodeIcon,
  LinkIcon,
} from 'lucide-react';

import { cn } from '@repo/ui/lib/utils';
import { Button } from './button';

interface IEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  contentClassName?: string;
}

interface IEditorToolbarProps {
  editor: ReturnType<typeof useEditor> | null;
  className?: string;
}

interface IEditorBubbleMenuProps {
  editor: ReturnType<typeof useEditor> | null;
  className?: string;
}

function Editor({
  value,
  onChange,
  placeholder = 'Write something...',
  className,
  contentClassName,
}: IEditorProps) {
  const editor = useEditor({
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        paragraph: {
          HTMLAttributes: {
            class: 'mb-4',
          },
        },
        heading: {
          HTMLAttributes: {
            class: 'font-bold mb-3',
          },
        },
        bulletList: {
          HTMLAttributes: {
            class: 'list-disc list-inside mb-4',
          },
        },
        orderedList: {
          HTMLAttributes: {
            class: 'list-decimal list-inside mb-4',
          },
        },
        blockquote: {
          HTMLAttributes: {
            class: 'border-l-4 border-primary pl-4 italic text-muted-foreground mb-4',
          },
        },
        codeBlock: {
          HTMLAttributes: {
            class: 'bg-muted rounded-md p-4 font-mono text-sm overflow-x-auto mb-4',
          },
        },
        link: {
          openOnClick: false,
          HTMLAttributes: {
            class: 'text-primary underline underline-offset-2',
          },
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      CharacterCount.configure(),
    ],
    content: value ?? '',
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
  });

  if (!editor) {
    return <div className={cn('rounded-md border', className)} />;
  }

  return (
    <div className={cn('rounded-md border border-input bg-background', className)}>
      <EditorToolbar editor={editor} />
      <div className="border-t border-input">
        <TiptapEditorContent
          editor={editor}
          className={cn(
            'prose dark:prose-invert prose-sm max-w-none',
            'px-4 py-3 focus:outline-none',
            '[&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg',
            '[&_ol]:list-decimal [&_ul]:list-disc',
            contentClassName,
          )}
        />
      </div>
      <EditorCharacterCount editor={editor} />
    </div>
  );
}

function EditorToolbar({ editor, className }: IEditorToolbarProps) {
  if (!editor) return null;

  const tools: {
    icon: LucideIcon;
    title: string;
    action: () => void;
    isActive?: () => boolean;
  }[] = [
    {
      icon: BoldIcon,
      title: 'Bold',
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive('bold'),
    },
    {
      icon: ItalicIcon,
      title: 'Italic',
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive('italic'),
    },
    {
      icon: UnderlineIcon,
      title: 'Underline',
      action: () => editor.chain().focus().toggleUnderline().run(),
      isActive: () => editor.isActive('underline'),
    },
    {
      icon: StrikethroughIcon,
      title: 'Strike',
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive('strike'),
    },
  ];

  const headingTools: {
    icon: LucideIcon;
    title: string;
    action: () => void;
    level: 1 | 2 | 3;
  }[] = [
    {
      icon: Heading1Icon,
      title: 'Heading 1',
      action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      level: 1,
    },
    {
      icon: Heading2Icon,
      title: 'Heading 2',
      action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      level: 2,
    },
    {
      icon: Heading3Icon,
      title: 'Heading 3',
      action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      level: 3,
    },
  ];

  const listTools: {
    icon: LucideIcon;
    title: string;
    action: () => void;
    isActive?: () => boolean;
  }[] = [
    {
      icon: ListIcon,
      title: 'Bullet List',
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive('bulletList'),
    },
    {
      icon: ListOrderedIcon,
      title: 'Ordered List',
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive('orderedList'),
    },
  ];

  const blockTools: {
    icon: LucideIcon;
    title: string;
    action: () => void;
    isActive?: () => boolean;
  }[] = [
    {
      icon: QuoteIcon,
      title: 'Blockquote',
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: () => editor.isActive('blockquote'),
    },
    {
      icon: CodeIcon,
      title: 'Code Block',
      action: () => editor.chain().focus().toggleCodeBlock().run(),
      isActive: () => editor.isActive('codeBlock'),
    },
  ];

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-1 border-b border-input bg-muted/30 p-2',
        className,
      )}
    >
      {tools.map((tool) => (
        <Button
          key={tool.title}
          variant={tool.isActive?.() ? 'default' : 'ghost'}
          size="sm"
          onClick={tool.action}
          title={tool.title}
          aria-label={tool.title}
          aria-pressed={tool.isActive?.() ?? false}
          className="h-8 w-8 p-0"
        >
          <tool.icon className="h-4 w-4" />
        </Button>
      ))}

      <div className="w-px bg-border" />

      {headingTools.map((tool) => (
        <Button
          key={`h${tool.level}`}
          variant="ghost"
          size="sm"
          onClick={tool.action}
          title={tool.title}
          aria-label={tool.title}
          className="h-8 w-8 p-0"
        >
          <tool.icon className="h-4 w-4" />
        </Button>
      ))}

      <div className="w-px bg-border" />

      {listTools.map((tool) => (
        <Button
          key={tool.title}
          variant={tool.isActive?.() ? 'default' : 'ghost'}
          size="sm"
          onClick={tool.action}
          title={tool.title}
          aria-label={tool.title}
          aria-pressed={tool.isActive?.() ?? false}
          className="h-8 w-8 p-0"
        >
          <tool.icon className="h-4 w-4" />
        </Button>
      ))}

      <div className="w-px bg-border" />

      {blockTools.map((tool) => (
        <Button
          key={tool.title}
          variant={tool.isActive?.() ? 'default' : 'ghost'}
          size="sm"
          onClick={tool.action}
          title={tool.title}
          aria-label={tool.title}
          aria-pressed={tool.isActive?.() ?? false}
          className="h-8 w-8 p-0"
        >
          <tool.icon className="h-4 w-4" />
        </Button>
      ))}

      <div className="w-px bg-border" />

      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          const url = window.prompt('Enter URL:');
          if (url) {
            editor.chain().focus().setLink({ href: url }).run();
          }
        }}
        title="Add Link"
        aria-label="Add Link"
        className="h-8 w-8 p-0"
      >
        <LinkIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

function EditorBubbleMenu({ editor, className }: IEditorBubbleMenuProps) {
  if (!editor) return null;

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 mb-2 flex items-center gap-1 rounded-md border border-input bg-background p-1 shadow-lg',
        className,
      )}
    >
      <Button
        variant={editor.isActive('bold') ? 'default' : 'ghost'}
        size="sm"
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-label="Bold"
        aria-pressed={editor.isActive('bold')}
        className="h-8 w-8 p-0"
      >
        <BoldIcon className="h-4 w-4" />
      </Button>
      <Button
        variant={editor.isActive('italic') ? 'default' : 'ghost'}
        size="sm"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-label="Italic"
        aria-pressed={editor.isActive('italic')}
        className="h-8 w-8 p-0"
      >
        <ItalicIcon className="h-4 w-4" />
      </Button>
      <Button
        variant={editor.isActive('underline') ? 'default' : 'ghost'}
        size="sm"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        aria-label="Underline"
        aria-pressed={editor.isActive('underline')}
        className="h-8 w-8 p-0"
      >
        <UnderlineIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

function EditorCharacterCount({ editor }: { editor: ReturnType<typeof useEditor> | null }) {
  if (!editor) return null;

  return (
    <div className="border-t border-input bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      {editor.storage.characterCount.characters()} characters
    </div>
  );
}

const EditorContent = TiptapEditorContent;

export { Editor, EditorToolbar, EditorBubbleMenu, EditorContent };
