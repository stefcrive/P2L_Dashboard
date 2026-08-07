import 'server-only';

import {
  normalizeResultClientIdentity,
  slugifyResultClient,
} from '@/lib/results/parser';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type InvoiceClientInput = {
  id?: string;
  name: string;
  billingDetails?: string;
  email?: string;
  phone?: string;
  taxId?: string;
};

export async function saveInvoiceClient(input: InvoiceClientInput) {
  const database = getSupabaseAdminClient();
  const { data: clients, error: clientsError } = await database
    .from('clients')
    .select('id, name, folder_slug');
  if (clientsError) throw new Error(clientsError.message);
  const normalizedName = normalizeResultClientIdentity(input.name);
  const existing =
    (clients ?? []).find((client: { id: string }) => client.id === input.id) ??
    (clients ?? []).find(
      (client: { name: string }) =>
        normalizeResultClientIdentity(client.name) === normalizedName
    );
  const values = {
    name: input.name.trim(),
    billing_details: input.billingDetails?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    tax_id: input.taxId?.trim() || null,
  };
  if (existing) {
    const { data, error } = await database
      .from('clients')
      .update(values)
      .eq('id', existing.id)
      .select(
        'id, name, folder_slug, billing_details, email, phone, tax_id, first_seen_year, last_seen_year, total_documents'
      )
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Unable to update client.');
    return data;
  }

  const baseSlug = slugifyResultClient(input.name);
  const occupied = new Set(
    (clients ?? []).map((client: { folder_slug: string }) => client.folder_slug)
  );
  let folderSlug = baseSlug;
  let suffix = 2;
  while (occupied.has(folderSlug)) {
    folderSlug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  const { data, error } = await database
    .from('clients')
    .insert({
      ...values,
      folder_slug: folderSlug,
      first_seen_year: null,
      last_seen_year: null,
      total_documents: 0,
      categories: [],
    })
    .select(
      'id, name, folder_slug, billing_details, email, phone, tax_id, first_seen_year, last_seen_year, total_documents'
    )
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Unable to create client.');
  return data;
}

