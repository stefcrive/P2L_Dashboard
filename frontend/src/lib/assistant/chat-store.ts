'use client';

import { create } from 'zustand';

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
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
              { ...message, id: makeId('message'), createdAt: now },
            ],
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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
  preferredConversationId?: string | null
) {
  const trimmed = content.trim();
  if (!trimmed) return;

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
  store.addMessage(conversationId, { role: 'user', content: trimmed });
  store.setPending(conversationId, true);

  try {
    const conversation = useAssistantChatStore
      .getState()
      .conversations.find((item) => item.id === conversationId);
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: (conversation?.messages ?? []).map(({ role, content: text }) => ({
          role,
          content: text,
        })),
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; error?: string }
      | null;
    if (!response.ok || !payload?.message) {
      throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
    }
    useAssistantChatStore
      .getState()
      .addMessage(conversationId, { role: 'assistant', content: payload.message });
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
