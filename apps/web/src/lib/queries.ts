'use client';

import type { CreateTicketForm, TicketIntent, TicketPriority, TicketStatus } from '@copilot/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  Agent,
  AiClassification,
  ClassifyResult,
  Customer,
  Draft,
  Escalation,
  EscalationDecisionResult,
  IngestResult,
  KbDocument,
  KbDocumentDetail,
  KbSearchResult,
  Page,
  Ticket,
  TicketDetail,
  TicketEvent,
} from './types';

export interface TicketFilters {
  status?: string;
  priority?: string;
  intent?: string;
  assigneeId?: string;
  q?: string;
  page?: number;
  sort?: string;
}

export const queryKeys = {
  agents: ['agents'] as const,
  customers: ['customers'] as const,
  tickets: ['tickets'] as const,
  ticketList: (f: TicketFilters) => ['tickets', 'list', f] as const,
  ticket: (id: string) => ['tickets', 'detail', id] as const,
  events: (id: string) => ['tickets', 'detail', id, 'events'] as const,
  classifications: (id: string) => ['tickets', 'detail', id, 'classifications'] as const,
  drafts: (id: string) => ['tickets', 'detail', id, 'drafts'] as const,
  escalations: (id: string) => ['tickets', 'detail', id, 'escalations'] as const,
  kbDocuments: ['kb', 'documents'] as const,
  kbDocument: (id: string) => ['kb', 'documents', id] as const,
};

export const useAgents = () =>
  useQuery({
    queryKey: queryKeys.agents,
    queryFn: ({ signal }) => api<Agent[]>('/agents', { signal }),
    staleTime: 5 * 60_000,
  });

/** Customers for the new-ticket picker. The seed has a handful; 100 is the API's page cap. */
export const useCustomers = () =>
  useQuery({
    queryKey: queryKeys.customers,
    queryFn: ({ signal }) =>
      api<Page<Customer>>('/customers', { query: { limit: 100, sort: 'name' }, signal }),
    staleTime: 60_000,
  });

export const PAGE_SIZE = 25;

export const useTickets = (filters: TicketFilters) =>
  useQuery({
    queryKey: queryKeys.ticketList(filters),
    queryFn: ({ signal }) =>
      api<Page<Ticket>>('/tickets', {
        query: { ...filters, limit: PAGE_SIZE, sort: filters.sort ?? '-updatedAt' },
        signal,
      }),
    placeholderData: keepPreviousData,
  });

export const useTicket = (id: string) =>
  useQuery({
    queryKey: queryKeys.ticket(id),
    queryFn: ({ signal }) => api<TicketDetail>(`/tickets/${id}`, { signal }),
  });

export const useTicketEvents = (id: string) =>
  useQuery({
    queryKey: queryKeys.events(id),
    queryFn: ({ signal }) => api<TicketEvent[]>(`/tickets/${id}/events`, { signal }),
  });

export const useClassifications = (id: string) =>
  useQuery({
    queryKey: queryKeys.classifications(id),
    queryFn: ({ signal }) => api<AiClassification[]>(`/tickets/${id}/classifications`, { signal }),
  });

export function useCreateTicket(actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTicketForm) =>
      api<TicketDetail>('/tickets', { method: 'POST', body, actorId }),
    onSuccess: (ticket) => {
      qc.setQueryData(queryKeys.ticket(ticket.id), ticket);
      void qc.invalidateQueries({ queryKey: queryKeys.tickets });
    },
  });
}

export type TicketChange =
  | { kind: 'status'; status: TicketStatus }
  | { kind: 'assign'; assigneeId: string | null }
  | { kind: 'priority'; priority: TicketPriority }
  | { kind: 'intent'; intent: TicketIntent };

/**
 * Every ticket mutation sends the version the agent is looking at. A 409 (someone else changed the
 * ticket) is surfaced by the caller; the cached ticket is left alone until the agent reloads.
 */
export function useUpdateTicket(ticket: TicketDetail | undefined, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (change: TicketChange) => {
      if (!ticket) throw new Error('Ticket not loaded');
      const { id, version } = ticket;
      switch (change.kind) {
        case 'status':
          return api<TicketDetail>(`/tickets/${id}/status`, {
            method: 'POST',
            body: { version, status: change.status },
            actorId,
          });
        case 'assign':
          return api<TicketDetail>(`/tickets/${id}/assign`, {
            method: 'POST',
            body: { version, assigneeId: change.assigneeId },
            actorId,
          });
        case 'priority':
          return api<TicketDetail>(`/tickets/${id}`, {
            method: 'PATCH',
            body: { version, priority: change.priority },
            actorId,
          });
        case 'intent':
          return api<TicketDetail>(`/tickets/${id}`, {
            method: 'PATCH',
            body: { version, intent: change.intent },
            actorId,
          });
      }
    },
    onSuccess: (updated) => {
      qc.setQueryData(queryKeys.ticket(updated.id), updated);
      void qc.invalidateQueries({ queryKey: queryKeys.events(updated.id) });
      void qc.invalidateQueries({ queryKey: [...queryKeys.tickets, 'list'] });
    },
  });
}

export function useClassifyTicket(ticketId: string, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<ClassifyResult>(`/tickets/${ticketId}/classify`, { method: 'POST', actorId }),
    onSuccess: ({ ticket }) => qc.setQueryData(queryKeys.ticket(ticketId), ticket),
    // A failed run is still recorded server-side, so refresh the run list either way.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.classifications(ticketId) });
      void qc.invalidateQueries({ queryKey: queryKeys.events(ticketId) });
      // Classification re-runs the escalation rules server-side.
      void qc.invalidateQueries({ queryKey: queryKeys.escalations(ticketId) });
      void qc.invalidateQueries({ queryKey: [...queryKeys.tickets, 'list'] });
    },
  });
}

// --- Drafts -------------------------------------------------------------------------------------

export const useDrafts = (ticketId: string) =>
  useQuery({
    queryKey: queryKeys.drafts(ticketId),
    queryFn: ({ signal }) => api<Draft[]>(`/tickets/${ticketId}/drafts`, { signal }),
  });

export function useGenerateDraft(ticketId: string, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Draft>(`/tickets/${ticketId}/drafts`, { method: 'POST', actorId }),
    onSuccess: (draft) =>
      qc.setQueryData<Draft[]>(queryKeys.drafts(ticketId), (old) => [draft, ...(old ?? [])]),
    // A holding reply is a KB gap, which can change the escalation recommendation.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.drafts(ticketId) });
      void qc.invalidateQueries({ queryKey: queryKeys.events(ticketId) });
      void qc.invalidateQueries({ queryKey: queryKeys.escalations(ticketId) });
    },
  });
}

export type DraftReview = { status: 'APPROVED'; content?: string } | { status: 'REJECTED' };

export function useReviewDraft(ticketId: string, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ draftId, review }: { draftId: string; review: DraftReview }) =>
      api<Draft>(`/drafts/${draftId}`, { method: 'PATCH', body: review, actorId }),
    onSuccess: (draft) => {
      qc.setQueryData<Draft[]>(queryKeys.drafts(ticketId), (old) =>
        old?.map((d) => (d.id === draft.id ? draft : d)),
      );
      // Approving adds the reply to the thread.
      void qc.invalidateQueries({ queryKey: queryKeys.ticket(ticketId), exact: true });
      void qc.invalidateQueries({ queryKey: queryKeys.events(ticketId) });
    },
  });
}

// --- Escalation ---------------------------------------------------------------------------------

export const useEscalations = (ticketId: string) =>
  useQuery({
    queryKey: queryKeys.escalations(ticketId),
    queryFn: ({ signal }) => api<Escalation[]>(`/tickets/${ticketId}/escalations`, { signal }),
  });

export function useEvaluateEscalation(ticketId: string, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<Escalation>(`/tickets/${ticketId}/escalation/evaluate`, { method: 'POST', actorId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.escalations(ticketId) });
      void qc.invalidateQueries({ queryKey: queryKeys.events(ticketId) });
    },
  });
}

export function useDecideEscalation(ticket: TicketDetail | undefined, actorId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      escalationId,
      decision,
    }: {
      escalationId: string;
      decision: 'ACCEPTED' | 'DISMISSED';
    }) =>
      api<EscalationDecisionResult>(`/escalations/${escalationId}/decision`, {
        method: 'POST',
        body: { decision, version: ticket?.version },
        actorId,
      }),
    onSuccess: ({ ticket: state }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ticket(state.id) });
      void qc.invalidateQueries({ queryKey: [...queryKeys.tickets, 'list'] });
    },
  });
}

// --- Knowledge base -----------------------------------------------------------------------------

export const useKbDocuments = () =>
  useQuery({
    queryKey: queryKeys.kbDocuments,
    queryFn: ({ signal }) => api<KbDocument[]>('/kb/documents', { signal }),
  });

export const useKbDocument = (id: string | null) =>
  useQuery({
    queryKey: queryKeys.kbDocument(id ?? ''),
    queryFn: ({ signal }) => api<KbDocumentDetail>(`/kb/documents/${id}`, { signal }),
    enabled: !!id,
  });

export interface NewKbDocument {
  title: string;
  category: string;
  slug?: string;
  content: string;
}

export function useCreateKbDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewKbDocument) =>
      api<IngestResult>('/kb/documents', { method: 'POST', body }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

export function useReindexKbDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<IngestResult>(`/kb/documents/${id}/reindex`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

export function useDeleteKbDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/kb/documents/${id}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['kb'] }),
  });
}

/** Search tester: a mutation, since each run is an explicit action and costs an embedding call. */
export const useKbSearch = () =>
  useMutation({
    mutationFn: (query: string) =>
      api<KbSearchResult>('/kb/search', { method: 'POST', body: { query } }),
  });
