import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

// Run against the local dashboard: node scripts/verify-quotation.mjs [base URL]
// Preview requests never create client documents or invoice records.
const baseUrl = process.argv[2] || 'http://localhost:3001';
const output = 'tmp/pdfs/quotation-verification';
await fs.mkdir(output, { recursive: true });
const description =
  'Análise da composição dos isótopos estáveis de C e O em amostras de testas de foraminíferos fornecidas pelo tomador do serviço, prazo previsto de entrega dos resultados entre 30 e 60 dias*';
const note =
  '*A depender do acúmulo de amostras já em processamento no laboratório no momento do recebimento das amostras do tomador de serviço';
const payload = {
  mode: 'preview',
  language: 'pt',
  currency: 'BRL',
  clientName: 'Cliente de verificação',
  clientDetails: 'São Paulo, Brasil',
  issueDate: '2026-10-16',
  dueDate: '',
  taxPercent: 0,
  items: [{ description, quantity: 1, unitPrice: 132 }],
  serviceDescription: '',
  additionalInfo: note,
  issuerDetails:
    'Laboratório de Paleoceanografia e Paleoclimatologia (P2L)\nEscola de Artes, Ciências e Humanidades\nUniversidade de São Paulo\nSão Paulo, Brazil',
  paymentInstructions: 'both',
  nationalPaymentDetails: 'PIX TEST PAYMENT',
  internationalPaymentDetails: 'SWIFT TEST PAYMENT',
  footerNote: '',
};
async function request(kind, overrides = {}) {
  return fetch(`${baseUrl}/api/${kind}/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...overrides }),
  });
}
async function inspect(kind, name, overrides = {}) {
  const response = await request(kind, overrides);
  assert.equal(
    response.status,
    200,
    await response
      .clone()
      .text()
      .then((t) => t.slice(0, 300))
  );
  assert.match(response.headers.get('content-type'), /application\/pdf/);
  assert.equal(response.headers.get('x-document-id'), null);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await fs.writeFile(`${output}/${name}.pdf`, bytes);
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const screenshots = await parser.getScreenshot({
      scale: 1.5,
      imageBuffer: true,
      imageDataUrl: false,
    });
    for (const page of screenshots.pages)
      await fs.writeFile(`${output}/${name}-${page.pageNumber}.png`, page.data);
    await fs.writeFile(`${output}/${name}.txt`, result.text);
    return result;
  } finally {
    await parser.destroy();
  }
}
const quote = await inspect('quotations', 'quotation');
const text = quote.text.replace(/\s+/g, ' ');
assert.match(text, /COTAÇÃO DE SERVIÇO/);
assert.match(text, /Analista responsável/);
assert.match(text, /R\$\s*132,00/);
assert.ok(text.includes(description));
assert.ok(text.includes(note));
assert.doesNotMatch(
  text,
  /FATURA|INVOICE|vencimento|Valor devido|Formas de pagamento|PIX TEST|SWIFT TEST/i
);
assert.equal(quote.total, 1);

const many = await inspect('quotations', 'quotation-multipage', {
  items: Array.from({ length: 18 }, (_, index) => ({
    description: `Serviço ${index + 1}. ${description}`,
    quantity: 1,
    unitPrice: 132,
  })),
});
assert.ok(many.total > 1);
assert.match(many.pages.at(-1).text, /Analista responsável/);
assert.equal((many.text.match(/Analista responsável/g) || []).length, 1);
for (let index = 1; index <= 18; index++)
  assert.ok(many.text.includes(`Serviço ${index}.`));

assert.equal((await request('invoices')).status, 400);
const invoice = await inspect('invoices', 'invoice-regression', {
  dueDate: '2026-11-16',
});
assert.match(invoice.text, /FATURA/);
assert.match(invoice.text, /vencimento/);
assert.match(invoice.text, /PIX TEST PAYMENT/);
assert.doesNotMatch(invoice.text, /COTAÇÃO DE SERVIÇO|Analista responsável/);
assert.equal((await request('quotations', { clientName: '' })).status, 400);
console.log(
  'Passed: quotation content, full service text, BRL total, no payment information, final-page signature, pagination, invoice regression, and validation.'
);
