'use client';

import {
  CreateTicketFormSchema,
  TICKET_CHANNELS,
  TICKET_LIMITS,
  type CreateTicketForm,
} from '@copilot/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAgent } from '@/lib/agent-context';
import { ApiError } from '@/lib/api';
import { CHANNEL_LABEL, TIER_LABEL } from '@/lib/format';
import { useCreateTicket, useCustomers } from '@/lib/queries';

const EMPTY: CreateTicketForm = { customerId: '', subject: '', body: '', channel: 'EMAIL' };

export function NewTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { current } = useAgent();
  const customers = useCustomers();
  const create = useCreateTicket(current?.id ?? null);
  const form = useForm<CreateTicketForm>({
    resolver: zodResolver(CreateTicketFormSchema),
    defaultValues: EMPTY,
  });
  const { errors } = form.formState;

  const close = (next: boolean) => {
    if (create.isPending) return;
    onOpenChange(next);
    if (!next) {
      form.reset(EMPTY);
      create.reset();
    }
  };

  const onSubmit = form.handleSubmit((values) =>
    create.mutate(values, {
      onSuccess: (ticket) => {
        toast.success(`Ticket #${ticket.number} created`, {
          description: ticket.intent
            ? undefined
            : 'Classification did not complete. Retry it from the ticket.',
        });
        close(false);
        router.push(`/tickets/${ticket.id}`);
      },
      onError: (err) => {
        // Server-side validation errors land on their fields; anything else shows above the footer.
        if (err instanceof ApiError) {
          for (const e of err.problem.errors ?? []) {
            if (e.field in EMPTY)
              form.setError(e.field as keyof CreateTicketForm, { message: e.message });
          }
        }
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle className="text-[15px] font-semibold">New ticket</DialogTitle>
          <DialogDescription className="text-xs">
            Logged on behalf of a customer. It is classified as soon as it is created.
          </DialogDescription>
        </DialogHeader>

        <form
          id="new-ticket"
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 px-5 py-4"
        >
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <Field label="Customer" htmlFor="customerId" error={errors.customerId?.message}>
              <Controller
                control={form.control}
                name="customerId"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={customers.isPending}
                  >
                    <SelectTrigger
                      id="customerId"
                      aria-invalid={!!errors.customerId}
                      className="w-full"
                      onBlur={field.onBlur}
                    >
                      <SelectValue
                        placeholder={
                          customers.isPending ? 'Loading customers…' : 'Choose a customer'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {customers.data?.items.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          <span className="text-muted-foreground">
                            {c.company ?? c.email}
                            {c.tier !== 'STANDARD' && ` · ${TIER_LABEL[c.tier]}`}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field label="Channel" htmlFor="channel">
              <Controller
                control={form.control}
                name="channel"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="channel" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {TICKET_CHANNELS.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CHANNEL_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>

          <Field label="Subject" htmlFor="subject" error={errors.subject?.message}>
            <Input
              id="subject"
              autoComplete="off"
              maxLength={TICKET_LIMITS.subject}
              aria-invalid={!!errors.subject}
              placeholder="Charged twice for October"
              {...form.register('subject')}
            />
          </Field>

          <Field label="Customer message" htmlFor="body" error={errors.body?.message}>
            <Textarea
              id="body"
              rows={7}
              maxLength={TICKET_LIMITS.body}
              aria-invalid={!!errors.body}
              placeholder="Paste or type what the customer wrote."
              className="min-h-[140px] resize-y"
              {...form.register('body')}
            />
          </Field>

          {customers.error && <InlineError error={customers.error} />}
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
          <Button type="submit" form="new-ticket" disabled={create.isPending}>
            {create.isPending ? 'Creating and classifying…' : 'Create ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
