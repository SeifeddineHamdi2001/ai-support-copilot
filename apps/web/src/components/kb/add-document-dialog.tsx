'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { InlineError } from '@/components/inline-error';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useCreateKbDocument } from '@/lib/queries';
import { INGEST_MESSAGE } from './kb-table';

/** Mirrors CreateKbDocumentDto, so most mistakes are caught before a request. */
const Schema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(200),
  category: z.string().trim().min(2, 'At least 2 characters').max(50),
  slug: z
    .string()
    .trim()
    .max(100)
    .regex(/^([a-z0-9]+(?:-[a-z0-9]+)*)?$/, 'Lowercase words joined by -')
    .optional(),
  content: z.string().trim().min(20, 'At least 20 characters').max(100_000),
});
type Form = z.infer<typeof Schema>;

const EMPTY: Form = { title: '', category: '', slug: '', content: '' };

export function AddDocumentDialog({
  open,
  onOpenChange,
  categories,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onAdded: (documentId: string) => void;
}) {
  const create = useCreateKbDocument();
  const form = useForm<Form>({ resolver: zodResolver(Schema), defaultValues: EMPTY });
  const { errors } = form.formState;
  const fileRef = useRef<HTMLInputElement>(null);

  const close = (next: boolean) => {
    if (create.isPending) return;
    onOpenChange(next);
    if (!next) {
      form.reset(EMPTY);
      create.reset();
    }
  };

  // A .md file fills the body, and the title from its first "# " heading when the title is empty.
  const loadFile = async (file: File) => {
    const text = await file.text();
    form.setValue('content', text, { shouldValidate: true });
    if (!form.getValues('title')) {
      const heading = /^#\s+(.+)$/m.exec(text)?.[1]?.trim();
      if (heading) form.setValue('title', heading, { shouldValidate: true });
    }
  };

  const onSubmit = form.handleSubmit((values) =>
    create.mutate(
      { ...values, slug: values.slug || undefined },
      {
        onSuccess: (r) => {
          toast.success(INGEST_MESSAGE[r.status], {
            description: `${r.document.title}: ${r.chunks} chunks indexed`,
          });
          close(false);
          onAdded(r.document.id);
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            for (const e of err.problem.errors ?? []) {
              if (e.field in EMPTY) form.setError(e.field as keyof Form, { message: e.message });
            }
          }
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold">Add document</DialogTitle>
          <DialogDescription className="text-xs">
            Markdown, split into chunks at its headings. Posting an existing slug replaces that
            document.
          </DialogDescription>
        </DialogHeader>

        <form
          id="add-document"
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 px-5 py-4"
        >
          <div className="grid grid-cols-[minmax(0,1fr)_180px] gap-3">
            <Field label="Title" htmlFor="kb-title" error={errors.title?.message}>
              <Input
                id="kb-title"
                autoComplete="off"
                placeholder="Refund policy"
                aria-invalid={!!errors.title}
                {...form.register('title')}
              />
            </Field>
            <Field label="Category" htmlFor="kb-category" error={errors.category?.message}>
              <Input
                id="kb-category"
                autoComplete="off"
                list="kb-categories"
                placeholder="billing"
                aria-invalid={!!errors.category}
                {...form.register('category')}
              />
              <datalist id="kb-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>

          <Field
            label="Slug"
            hint="Optional. Defaults to the title."
            htmlFor="kb-slug"
            error={errors.slug?.message}
          >
            <Input
              id="kb-slug"
              autoComplete="off"
              placeholder="refund-policy"
              className="font-mono text-xs"
              aria-invalid={!!errors.slug}
              {...form.register('slug')}
            />
          </Field>

          <Field
            label="Content"
            htmlFor="kb-content"
            error={errors.content?.message}
            action={
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".md,.markdown,text/markdown,text/plain"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadFile(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => fileRef.current?.click()}
                >
                  Load .md file
                </Button>
              </>
            }
          >
            <Textarea
              id="kb-content"
              rows={14}
              spellCheck={false}
              aria-invalid={!!errors.content}
              placeholder={
                '# Refund policy\n\n## Duplicate charges\n\nDuplicate charges are refunded…'
              }
              className="max-h-[50vh] min-h-[220px] resize-y font-mono text-xs leading-relaxed"
              {...form.register('content')}
            />
          </Field>

          {create.error &&
            !(create.error instanceof ApiError && create.error.problem.errors?.length) && (
              <InlineError error={create.error} />
            )}
        </form>

        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => close(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" form="add-document" disabled={create.isPending}>
            {create.isPending ? 'Indexing…' : 'Add and index'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  htmlFor,
  error,
  action,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  error?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-6 items-center gap-2">
        <Label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
        </Label>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  );
}
