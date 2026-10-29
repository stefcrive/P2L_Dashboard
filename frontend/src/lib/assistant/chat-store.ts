'use client';
import { postUploadForm } from '@/lib/cloud/upload-client';

import { create } from 'zustand';

import type { KnowledgeRetrievalTrace } from '@/lib/knowledge/types';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  attachments?: AssistantAttachment[];
  mode?: 'assistant' | 'knowledge';
  evidence?: KnowledgeEvidence[];
  knowledgeEngineNames?: string[];
  thinking?: boolean;
  trace?: KnowledgeRetrievalTrace;
}

export interface KnowledgeEvidence {
  chunkId: number;
  sourceId: number;
  sourceName: string;
  sourcePath: string;
  subject: string;
  author: string;
  messageDate: string | null;
  startLine: number;
  endLine: number;
  content: string;
  rerankScore?: number;
  visual?: {
    id: number;
    pageNumber: number;
    kind: string;
    caption: string;
    description: string;
    altText: string;
    width: number;
    height: number;
    bbox: Record<string, unknown>;
    imageUrl: string;
    sourceUrl: string;
  } | null;
}

export interface AssistantAttachment {
  name: string;
  type: string;
  size: number;
  uploadId?: string;
  documentId?: string;
  clientId?: string;
  clientName?: string;
}

export interface AssistantConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AssistantMessage[];
}

interface PersistedAssistantState {
  conversations: AssistantConversation[];
  activeConversationId: string | null;
}

interface AssistantChatState extends PersistedAssistantState {
  hydrated: boolean;
  pendingConversationIds: string[];
  errors: Record<string, string>;
  hydrate: () => void;
  createConversation: () => string;
  selectConversation: (id: string) => void;
  removeAllConversations: () => string;
  clearConversation: (id: string) => void;
  addMessage: (
    conversationId: string,
    message: Omit<AssistantMessage, 'id' | 'createdAt'>
  ) => string;
  updateMessageAttachments: (
    conversationId: string,
    messageId: string,
    attachments: AssistantAttachment[]
  ) => void;
  setPending: (conversationId: string, pending: boolean) => void;
  setError: (conversationId: string, error: string) => void;
}

const STORAGE_KEY = 'p2l-assistant-conversations-v1';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function newConversation(): AssistantConversation {
  const now = new Date().toISOString();
  return {
    id: makeId('chat'),
    title: 'New review',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function persistState(state: AssistantChatState) {
  if (typeof window === 'undefined') return;
  const snapshot: PersistedAssistantState = {
    conversations: state.conversations,
    activeConversationId: state.activeConversationId,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export const useAssistantChatStore = create<AssistantChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  hydrated: false,
  pendingConversationIds: [],
  errors: {},

  hydrate: () => {
    if (get().hydrated) return;
    let persisted: PersistedAssistantState | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      persisted = raw ? (JSON.parse(raw) as PersistedAssistantState) : null;
    } catch {
      persisted = null;
    }

    const conversations =
      persisted?.conversations?.filter(
        (conversation) =>
          conversation &&
          typeof conversation.id === 'string' &&
          Array.isArray(conversation.messages)
      ) ?? [];
    const activeExists = conversations.some(
      (conversation) => conversation.id === persisted?.activeConversationId
    );
    const initial = conversations.length ? conversations : [newConversation()];
    set({
      conversations: initial,
      activeConversationId: activeExists
        ? persisted?.activeConversationId ?? initial[0].id
        : initial[0].id,
      hydrated: true,
    });
    persistState(get());
  },

  createConversation: () => {
    const conversation = newConversation();
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
      errors: { ...state.errors, [conversation.id]: '' },
    }));
    persistState(get());
    return conversation.id;
  },

  selectConversation: (id) => {
    if (!get().conversations.some((conversation) => conversation.id === id)) return;
    set({ activeConversationId: id });
    persistState(get());
  },

  removeAllConversations: () => {
    const conversation = newConversation();
    set({
      conversations: [conversation],
      activeConversationId: conversation.id,
      pendingConversationIds: [],
      errors: {},
    });
    persistState(get());
    return conversation.id;
  },

  clearConversation: (id) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === id
          ? {
              ...conversation,
              title: 'New review',
              updatedAt: new Date().toISOString(),
              messages: [],
            }
          : conversation
      ),
      errors: { ...state.errors, [id]: '' },
    }));
    persistState(get());
  },

  addMessage: (conversationId, message) => {
    const now = new Date().toISOString();
    const messageId = makeId('message');
    set((state) => ({
      conversations: state.conversations
        .map((conversation) => {
          if (conversation.id !== conversationId) return conversation;
          const isFirstUserMessage =
            message.role === 'user' &&
            !conversation.messages.some((item) => item.role === 'user');
          const title = isFirstUserMessage
            ? message.content.replace(/\s+/g, ' ').trim().slice(0, 54)
            : conversation.title;
          return {
            ...conversation,
            title: title || 'New review',
            updatedAt: now,
            messages: [
              ...conversation.messages,
              { ...message, id: messageId, createdAt: now },
            ],
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
    persistState(get());
    return messageId;
  },

  updateMessageAttachments: (conversationId, messageId, attachments) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === messageId ? { ...message, attachments } : message
              ),
            }
          : conversation
      ),
    }));
    persistState(get());
  },

  setPending: (conversationId, pending) => {
    set((state) => ({
      pendingConversationIds: pending
        ? Array.from(new Set([...state.pendingConversationIds, conversationId]))
        : state.pendingConversationIds.filter((id) => id !== conversationId),
    }));
  },

  setError: (conversationId, error) => {
    set((state) => ({ errors: { ...state.errors, [conversationId]: error } }));
  },
}));

export async function sendAssistantMessage(
  content: string,
  preferredConversationId?: string | null,
  files: File[] = [],
  options: {
    knowledgeEngineIds?: string[];
    knowledgeEngineNames?: string[];
    thinking?: boolean;
  } = {}
) {
  const trimmed = content.trim();
  if (!trimmed && !files.length) return;
  const messageText = trimmed || 'Review the attached file(s).';

  let store = useAssistantChatStore.getState();
  let conversationId = preferredConversationId ?? store.activeConversationId;
  if (
    !conversationId ||
    !store.conversations.some((conversation) => conversation.id === conversationId)
  ) {
    conversationId = store.createConversation();
    store = useAssistantChatStore.getState();
  }

  store.setError(conversationId, '');
  const userMessageId = store.addMessage(conversationId, {
    role: 'user',
    content: messageText,
    attachments: files.map((file) => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
    })),
    knowledgeEngineNames: options.knowledgeEngineNames,
    thinking: options.thinking,
  });
  store.setPending(conversationId, true);

  try {
    const conversation = useAssistantChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    const messages = (conversation?.messages ?? []).map(
      ({ role, content: text, attachments }) => ({ role, content: text, attachments })
    );
    const formData = new FormData();
    formData.set('messages', JSON.stringify(messages));
    if (options.knowledgeEngineIds !== undefined) {
      formData.set(
        'knowledgeEngineIds',
        JSON.stringify(options.knowledgeEngineIds)
      );
    }
    formData.set('thinking', String(Boolean(options.thinking)));
    files.forEach((file) => formData.append('files', file));
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 165_000);
    let response: Response;
    try {
      response = await postUploadForm('/api/assistant', formData, controller.signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          'The assistant request timed out and was stopped. Refresh queue data before retrying.'
        );
      }
      throw error;
    } finally {
      window.clearTimeout(requestTimeout);
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          message?: string;
          error?: string;
          attachments?: AssistantAttachment[];
          mode?: 'assistant' | 'knowledge';
          evidence?: KnowledgeEvidence[];
          trace?: KnowledgeRetrievalTrace;
        }
      | null;
    if (payload?.attachments?.length) {
      useAssistantChatStore
        .getState()
        .updateMessageAttachments(conversationId, userMessageId, payload.attachments);
    }
    if (!response.ok || !payload?.message) {
      throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
    }
    useAssistantChatStore
      .getState()
      .addMessage(conversationId, {
        role: 'assistant',
        content: payload.message,
        mode: payload.mode ?? 'assistant',
        evidence: payload.evidence ?? [],
        thinking: options.thinking,
        trace: payload.trace,
        knowledgeEngineNames:
          payload.mode === 'knowledge'
            ? options.knowledgeEngineNames
            : undefined,
      });
  } catch (error) {
    useAssistantChatStore
      .getState()
      .setError(
        conversationId,
        error instanceof Error ? error.message : 'The assistant request failed.'
      );
  } finally {
    useAssistantChatStore.getState().setPending(conversationId, false);
  }
}
