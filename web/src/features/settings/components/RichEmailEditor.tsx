import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { Bold, Highlighter, ImagePlus, Italic, Link as LinkIcon, List, ListOrdered, Redo2, Undo2 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import type { EmailTokenType } from '../../domain/emailTemplates';

type RichEmailEditorProps = {
  value: string;
  onChange: (html: string) => void;
  allowImages?: boolean;
  allowTokens?: boolean;
};

type TokenSubjectEditorProps = {
  value: string;
  onChange: (html: string) => void;
};

const tokenLabels: Record<EmailTokenType, string> = {
  student_name: 'Student name',
  project_number: 'Project number',
  project_link: 'Project link'
};

export const EmailToken = Node.create({
  name: 'emailToken',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      token: {
        default: 'student_name',
        parseHTML: element => element.getAttribute('data-email-token') || 'student_name',
        renderHTML: attributes => ({ 'data-email-token': attributes.token })
      },
      label: {
        default: '',
        parseHTML: element => element.getAttribute('data-label') || '',
        renderHTML: attributes => attributes.label ? { 'data-label': attributes.label } : {}
      }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-email-token]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const token = HTMLAttributes['data-email-token'] as EmailTokenType;
    const label = HTMLAttributes['data-label'] || tokenLabels[token] || 'Token';
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'email-token-chip',
        contenteditable: 'false'
      }),
      label
    ];
  }
});

const EmailFormatting = Extension.create({
  name: 'emailFormatting',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize || null,
            renderHTML: attributes => attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {}
          }
        }
      },
      {
        types: ['paragraph'],
        attributes: {
          paragraphSpacing: {
            default: null,
            parseHTML: element => element.getAttribute('data-paragraph-spacing'),
            renderHTML: attributes => {
              if (attributes.paragraphSpacing === 'none') {
                return { 'data-paragraph-spacing': 'none', style: 'margin: 0; line-height: 1.15;' };
              }
              if (attributes.paragraphSpacing === 'tight') {
                return { 'data-paragraph-spacing': 'tight', style: 'margin: 0 0 0.25rem; line-height: 1.25;' };
              }
              return {};
            }
          }
        }
      }
    ];
  }
});

const toolbarButtonClass = (active = false) =>
  [
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-bold transition',
    active
      ? 'border-sky-500 bg-slate-950 text-white shadow-sm'
      : 'border-slate-300 bg-white text-slate-800 hover:border-[color:var(--forge-gold-border)] hover:bg-sky-50'
  ].join(' ');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const subjectToEditorHtml = (value: string) => {
  if (/<[a-z][\s\S]*>/i.test(value)) return value;

  const escaped = escapeHtml(value)
    .replace(/\{\{\s*student_name\s*\}\}/gi, '<span data-email-token="student_name" data-label="Student name"></span>')
    .replace(/\{\{\s*project_number\s*\}\}/gi, '<span data-email-token="project_number" data-label="Project #"></span>')
    .replace(/\{\{\s*project_link\s*\}\}/gi, '<span data-email-token="project_link" data-label="Project link"></span>');

  return `<p>${escaped}</p>`;
};

export const TokenSubjectEditor = ({ value, onChange }: TokenSubjectEditorProps) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false
      }),
      EmailToken
    ],
    content: subjectToEditorHtml(value),
    editorProps: {
      attributes: {
        class: 'subject-token-editor forge-command-input min-h-10 px-3 py-2 text-sm font-semibold'
      },
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          return true;
        }
        return false;
      }
    },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getHTML())
  });

  useEffect(() => {
    if (!editor) return;
    const nextContent = subjectToEditorHtml(value);
    if (editor.getHTML() === nextContent) return;
    editor.commands.setContent(nextContent, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const insertToken = (token: EmailTokenType) => {
    const label = token === 'project_link' ? 'Project link' : tokenLabels[token];
    editor.chain().focus().insertContent({
      type: 'emailToken',
      attrs: { token, label }
    }).run();
  };

  return (
    <div className="space-y-2">
      <EditorContent editor={editor} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => insertToken('student_name')} className="forge-badge forge-badge-blue px-3 py-1 text-xs transition hover:bg-sky-100">
          Add student name
        </button>
        <button type="button" onClick={() => insertToken('project_number')} className="forge-badge forge-badge-blue px-3 py-1 text-xs transition hover:bg-sky-100">
          Add project #
        </button>
        <button type="button" onClick={() => insertToken('project_link')} className="forge-badge forge-badge-blue px-3 py-1 text-xs transition hover:bg-sky-100">
          Add project link
        </button>
      </div>
    </div>
  );
};

export const RichEmailEditor = ({
  value,
  onChange,
  allowImages = false,
  allowTokens = false
}: RichEmailEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TextStyle,
      Color,
      FontFamily,
      EmailFormatting,
      EmailToken
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'rich-email-editor min-h-[18rem] rounded-b-md bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-sky-300'
      }
    },
    onUpdate: ({ editor: activeEditor }) => onChange(activeEditor.getHTML())
  });

  useEffect(() => {
    if (!editor || editor.getHTML() === value) return;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) return null;

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Paste the link URL', previousUrl || 'https://');
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const insertToken = (token: EmailTokenType) => {
    const label = token === 'project_link'
      ? window.prompt('Link text', 'View your print') || 'View your print'
      : tokenLabels[token];
    editor.chain().focus().insertContent({
      type: 'emailToken',
      attrs: { token, label }
    }).run();
  };

  const uploadSignatureImage = async (file: File) => {
    setUploadingImage(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `signatures/${crypto.randomUUID()}.${extension}`;
      const { data, error } = await supabase.storage
        .from('email-assets')
        .upload(path, file, {
          cacheControl: '31536000',
          contentType: file.type || 'image/png',
          upsert: false
        });

      if (error) throw error;

      const { data: publicUrlData } = supabase.storage
        .from('email-assets')
        .getPublicUrl(data?.path || path);

      if (!publicUrlData.publicUrl) throw new Error('Supabase did not return a public image URL.');
      editor.chain().focus().setImage({ src: publicUrlData.publicUrl, alt: file.name }).run();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Signature image upload failed.');
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="forge-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-300 bg-slate-100/90 p-2">
        <button type="button" className={toolbarButtonClass(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold">
          <Bold size={15} />
        </button>
        <button type="button" className={toolbarButtonClass(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic">
          <Italic size={15} />
        </button>
        <button type="button" className={toolbarButtonClass(editor.isActive('highlight'))} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()} title="Highlight">
          <Highlighter size={15} />
        </button>
        <label className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800">
          Font
          <select
            className="h-6 rounded border border-slate-300 bg-white px-1 text-xs focus:border-sky-500 focus:outline-none"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (!value) editor.chain().focus().unsetFontFamily().run();
              else editor.chain().focus().setFontFamily(value).run();
            }}
            aria-label="Font family"
          >
            <option value="">Default</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Times New Roman', serif">Times</option>
            <option value="'Courier New', monospace">Courier</option>
          </select>
        </label>
        <label className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800">
          Size
          <select
            className="h-6 rounded border border-slate-300 bg-white px-1 text-xs focus:border-sky-500 focus:outline-none"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value;
              if (!value) editor.chain().focus().setMark('textStyle', { fontSize: null }).run();
              else editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
            }}
            aria-label="Font size"
          >
            <option value="">Default</option>
            <option value="12px">12</option>
            <option value="14px">14</option>
            <option value="16px">16</option>
            <option value="18px">18</option>
            <option value="22px">22</option>
          </select>
        </label>
        <label className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800">
          Spacing
          <select
            className="h-6 rounded border border-slate-300 bg-white px-1 text-xs focus:border-sky-500 focus:outline-none"
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value || null;
              editor.chain().focus().updateAttributes('paragraph', { paragraphSpacing: value }).run();
            }}
            aria-label="Paragraph spacing"
          >
            <option value="">Normal</option>
            <option value="tight">Tight</option>
            <option value="none">No spacing</option>
          </select>
        </label>
        <label className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-bold text-slate-800">
          Text
          <input
            type="color"
            className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
            aria-label="Text color"
          />
        </label>
        <button type="button" className={toolbarButtonClass(editor.isActive('link'))} onClick={setLink} title="Link">
          <LinkIcon size={15} />
        </button>
        <button type="button" className={toolbarButtonClass(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <List size={15} />
        </button>
        <button type="button" className={toolbarButtonClass(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <ListOrdered size={15} />
        </button>
        <button type="button" className={toolbarButtonClass()} onClick={() => editor.chain().focus().undo().run()} title="Undo">
          <Undo2 size={15} />
        </button>
        <button type="button" className={toolbarButtonClass()} onClick={() => editor.chain().focus().redo().run()} title="Redo">
          <Redo2 size={15} />
        </button>

        {allowTokens && (
          <div className="ml-1 flex flex-wrap gap-1 border-l border-slate-300 pl-2">
            <button type="button" className={toolbarButtonClass()} onClick={() => insertToken('student_name')}>Student name</button>
            <button type="button" className={toolbarButtonClass()} onClick={() => insertToken('project_number')}>Project #</button>
            <button type="button" className={toolbarButtonClass()} onClick={() => insertToken('project_link')}>Project link</button>
          </div>
        )}

        {allowImages && (
          <div className="ml-1 border-l border-slate-300 pl-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadSignatureImage(file);
              }}
            />
            <button
              type="button"
              className={toolbarButtonClass()}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage}
              title="Upload signature image"
            >
              <ImagePlus size={15} />
              <span className="ml-1">{uploadingImage ? 'Uploading...' : 'Image'}</span>
            </button>
          </div>
        )}
      </div>

      <EditorContent editor={editor} />
    </div>
  );
};
