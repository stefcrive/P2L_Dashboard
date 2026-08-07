export type ResourceResponse<T> = {
  data: T[];
  source: 'local' | 'supabase';
};

async function readJson(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? 'The operation could not be completed.');
  }
  return payload;
}

export async function fetchResource<T>(resource: string): Promise<T[]> {
  const response = await fetch(`/api/operations/${resource}`, {
    cache: 'no-store',
  });
  const payload = (await readJson(response)) as ResourceResponse<T>;
  return payload.data;
}

export async function createResource<T>(
  resource: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`/api/operations/${resource}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await readJson(response);
  return result.data as T;
}

export async function updateResource<T>(
  resource: string,
  id: string,
  payload: Record<string, unknown>
): Promise<T> {
  const response = await fetch(
    `/api/operations/${resource}?id=${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );
  const result = await readJson(response);
  return result.data as T;
}

export const selectClassName =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25';

export const textareaClassName =
  'min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25';
