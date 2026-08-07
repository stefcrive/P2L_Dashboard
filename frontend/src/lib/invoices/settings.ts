export type InvoiceSettings = {
  id: 'default';
  issuer_details: string;
  national_payment_details: string;
  international_payment_details: string;
  default_payment_instructions: 'national' | 'international' | 'both';
  default_currency: string;
  default_language: 'en' | 'pt';
  footer_note: string;
  updated_at?: string;
};

export const fallbackInvoiceSettings: InvoiceSettings = {
  id: 'default',
  issuer_details:
    'Laboratório de Paleoceanografia e Paleoclimatologia (P2L)\nEscola de Artes, Ciências e Humanidades\nUniversidade de São Paulo\nSão Paulo, Brazil',
  national_payment_details: '',
  international_payment_details: '',
  default_payment_instructions: 'both',
  default_currency: 'BRL',
  default_language: 'en',
  footer_note: 'P2L · EACH-USP · Universidade de São Paulo',
};
