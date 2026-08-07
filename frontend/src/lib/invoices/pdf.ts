import 'server-only';

import fs from 'node:fs';
import path from 'node:path';

import {
  degrees,
  PDFDocument,
  type PDFImage,
  type PDFPage,
  rgb,
  StandardFonts,
} from 'pdf-lib';

export type InvoiceLanguage = 'en' | 'pt';
export type PaymentInstructionMode =
  | 'national'
  | 'international'
  | 'both';

export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type InvoicePdfPayload = {
  invoiceNumber: string;
  language: InvoiceLanguage;
  currency: string;
  clientName: string;
  clientDetails: string;
  issueDate: string;
  dueDate: string;
  taxPercent: number;
  items: InvoiceItemInput[];
  serviceDescription: string;
  additionalInfo: string;
  issuerDetails: string;
  paymentInstructions: PaymentInstructionMode;
  nationalPaymentDetails: string;
  internationalPaymentDetails: string;
};

const A4 = { width: 595.28, height: 841.89 };
const navy = rgb(0.035, 0.12, 0.24);
const muted = rgb(0.35, 0.42, 0.54);
const line = rgb(0.84, 0.88, 0.93);
const cyan = rgb(0.07, 0.63, 0.72);
const blue = rgb(0.05, 0.34, 0.52);
const orange = rgb(0.92, 0.45, 0.08);

const copy = {
  en: {
    title: 'INVOICE',
    invoiceNumber: 'Invoice number',
    issueDate: 'Issue date',
    billedTo: 'Billed to',
    issuedBy: 'Issued by',
    dueHeadline: (amount: string, date: string) => `${amount} due by ${date}`,
    product: 'Product or service',
    quantity: 'Quantity',
    unitPrice: 'Unit price',
    tax: 'Tax',
    total: 'Total',
    excludingTax: 'Total excluding tax',
    totalTax: 'Total tax',
    amountDue: 'Amount due',
    waysToPay: 'Ways to pay',
    national: 'National payment details',
    international: 'International payment details',
    additional: 'Additional information',
    page: 'Page',
  },
  pt: {
    title: 'FATURA',
    invoiceNumber: 'Número da fatura',
    issueDate: 'Data de emissão',
    billedTo: 'Faturado para',
    issuedBy: 'Emitido por',
    dueHeadline: (amount: string, date: string) =>
      `${amount} com vencimento em ${date}`,
    product: 'Produto ou serviço',
    quantity: 'Quantidade',
    unitPrice: 'Preço unitário',
    tax: 'Imposto',
    total: 'Total',
    excludingTax: 'Total sem impostos',
    totalTax: 'Total de impostos',
    amountDue: 'Valor devido',
    waysToPay: 'Formas de pagamento',
    national: 'Dados para pagamento nacional',
    international: 'Dados para pagamento internacional',
    additional: 'Informações adicionais',
    page: 'Página',
  },
} as const;

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  return (
    candidates.find((candidate) => fs.existsSync(path.join(candidate, 'logos'))) ??
    process.cwd()
  );
}

function safePdfText(value: string) {
  return String(value ?? '')
    .replace(/[δΔ]/g, (character) => (character === 'δ' ? 'delta' : 'Delta'))
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '-')
    .replace(/\u2030/g, ' per mille')
    .replace(/\u00a0/g, ' ')
    .replace(
      /[^\u0009\u000A\u000D\u0020-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018\u2019\u201A\u201C\u201D\u201E\u2020\u2021\u2022\u2026\u2039\u203A\u20AC\u2122]/g,
      '?'
    );
}

function wrapText(
  text: string,
  font: { widthOfTextAtSize: (value: string, size: number) => number },
  size: number,
  maxWidth: number
) {
  const lines: string[] = [];
  for (const paragraph of safePdfText(text).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function formatDate(value: string, language: InvoiceLanguage) {
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'pt' ? 'pt-BR' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

function formatMoney(
  value: number,
  currency: string,
  language: InvoiceLanguage
) {
  const locale = language === 'pt' ? 'pt-BR' : 'en-US';
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)} ${currency.toUpperCase()}`;
}

async function embedBrandImages(document: PDFDocument) {
  const logoRoot = path.join(findRepositoryRoot(), 'logos');
  const [eachBytes, uspBytes, p2lBytes] = await Promise.all([
    fs.promises.readFile(path.join(logoRoot, 'Logo_EACH-USP.png')),
    fs.promises.readFile(path.join(logoRoot, 'USP-wordmark.png')),
    fs.promises.readFile(path.join(logoRoot, 'logo_pt.png')),
  ]);
  return {
    each: await document.embedPng(eachBytes),
    usp: await document.embedPng(uspBytes),
    p2l: await document.embedPng(p2lBytes),
  };
}

function drawPaper(page: PDFPage) {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: A4.width,
    height: A4.height,
    color: rgb(0.995, 0.998, 1),
  });
  page.drawRectangle({
    x: -32,
    y: 718,
    width: 390,
    height: 146,
    color: cyan,
    opacity: 0.025,
  });
  page.drawRectangle({
    x: 456,
    y: 695,
    width: 180,
    height: 34,
    color: blue,
    opacity: 0.045,
    rotate: degrees(-12),
  });
  page.drawRectangle({
    x: 472,
    y: 636,
    width: 170,
    height: 30,
    color: cyan,
    opacity: 0.04,
    rotate: degrees(-12),
  });
  page.drawRectangle({
    x: -45,
    y: 32,
    width: 230,
    height: 28,
    color: orange,
    opacity: 0.025,
    rotate: degrees(8),
  });
}

function drawBrandHeader(
  page: PDFPage,
  fonts: { regular: any; bold: any },
  images: { each: PDFImage; usp: PDFImage; p2l: PDFImage }
) {
  const each = images.each.scaleToFit(34, 34);
  page.drawImage(images.each, {
    x: 42,
    y: 784,
    width: each.width,
    height: each.height,
  });
  page.drawText('EACH', {
    x: 80,
    y: 798,
    size: 18,
    font: fonts.bold,
    color: navy,
  });
  page.drawLine({
    start: { x: 136, y: 790 },
    end: { x: 136, y: 818 },
    thickness: 0.8,
    color: muted,
  });
  const usp = images.usp.scaleToFit(58, 25);
  page.drawImage(images.usp, {
    x: 144,
    y: 791,
    width: usp.width,
    height: usp.height,
  });
  page.drawText('Escola de Artes, Ciências e Humanidades', {
    x: 80,
    y: 785,
    size: 5.8,
    font: fonts.regular,
    color: muted,
  });
  page.drawText('Universidade de São Paulo', {
    x: 80,
    y: 777,
    size: 5.8,
    font: fonts.regular,
    color: muted,
  });
  const p2l = images.p2l.scaleToFit(184, 58);
  page.drawImage(images.p2l, {
    x: A4.width - 42 - p2l.width,
    y: 773,
    width: p2l.width,
    height: p2l.height,
  });
  page.drawLine({
    start: { x: 42, y: 760 },
    end: { x: 310, y: 760 },
    thickness: 1.8,
    color: cyan,
  });
  page.drawLine({
    start: { x: 310, y: 760 },
    end: { x: 430, y: 760 },
    thickness: 1.8,
    color: blue,
  });
  page.drawLine({
    start: { x: 430, y: 760 },
    end: { x: A4.width - 42, y: 760 },
    thickness: 1.8,
    color: orange,
  });
}

export async function createInvoicePdf(payload: InvoicePdfPayload) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const images = await embedBrandImages(pdf);
  const language = payload.language;
  const labels = copy[language];
  const subtotal = payload.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const taxAmount = subtotal * (payload.taxPercent / 100);
  const total = subtotal + taxAmount;
  const margin = 42;
  const contentWidth = A4.width - margin * 2;
  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]);
  pages.push(page);
  drawPaper(page);
  drawBrandHeader(page, fonts, images);
  let y = 722;

  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    drawPaper(page);
    drawBrandHeader(page, fonts, images);
    y = 730;
  };
  const ensureSpace = (height: number) => {
    if (y - height < 70) addPage();
  };
  const drawLines = (
    text: string,
    options: {
      x: number;
      maxWidth: number;
      size?: number;
      leading?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
    }
  ) => {
    const size = options.size ?? 9;
    const leading = options.leading ?? size * 1.35;
    const font = options.bold ? fonts.bold : fonts.regular;
    const lines = wrapText(text, font, size, options.maxWidth);
    ensureSpace(lines.length * leading);
    lines.forEach((lineText) => {
      page.drawText(lineText, {
        x: options.x,
        y,
        size,
        font,
        color: options.color ?? navy,
      });
      y -= leading;
    });
    return lines.length;
  };

  page.drawText(labels.title, {
    x: margin,
    y,
    size: 28,
    font: fonts.bold,
    color: navy,
  });
  page.drawText(labels.invoiceNumber, {
    x: 366,
    y: y + 10,
    size: 7.5,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(safePdfText(payload.invoiceNumber), {
    x: 366,
    y: y - 5,
    size: 10,
    font: fonts.regular,
    color: navy,
  });
  page.drawText(labels.issueDate, {
    x: 468,
    y: y + 10,
    size: 7.5,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(safePdfText(formatDate(payload.issueDate, language)), {
    x: 468,
    y: y - 5,
    size: 8.5,
    font: fonts.regular,
    color: navy,
  });
  y -= 48;
  page.drawLine({
    start: { x: margin, y },
    end: { x: A4.width - margin, y },
    thickness: 0.8,
    color: line,
  });
  y -= 25;

  const partyTop = y;
  page.drawText(labels.billedTo, {
    x: margin,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(labels.issuedBy, {
    x: 326,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  const clientLines = wrapText(
    `${payload.clientName}\n${payload.clientDetails}`,
    fonts.regular,
    9,
    225
  );
  const issuerLines = wrapText(payload.issuerDetails, fonts.regular, 9, 225);
  const partyLineCount = Math.max(clientLines.length, issuerLines.length);
  clientLines.forEach((text, index) => {
    page.drawText(text, {
      x: margin,
      y: partyTop - 20 - index * 12,
      size: index === 0 ? 10 : 9,
      font: index === 0 ? fonts.bold : fonts.regular,
      color: index === 0 ? navy : muted,
    });
  });
  issuerLines.forEach((text, index) => {
    page.drawText(text, {
      x: 326,
      y: partyTop - 20 - index * 12,
      size: index === 0 ? 9.5 : 9,
      font: index === 0 ? fonts.bold : fonts.regular,
      color: index === 0 ? navy : muted,
    });
  });
  y = partyTop - 30 - partyLineCount * 12;
  ensureSpace(55);
  page.drawText(
    safePdfText(
      labels.dueHeadline(
        formatMoney(total, payload.currency, language),
        formatDate(payload.dueDate, language)
      )
    ),
    {
      x: margin,
      y,
      size: 19,
      font: fonts.bold,
      color: navy,
    }
  );
  y -= 40;

  if (payload.serviceDescription.trim()) {
    drawLines(payload.serviceDescription, {
      x: margin,
      maxWidth: contentWidth,
      size: 9,
      leading: 12,
    });
    y -= 14;
  }

  ensureSpace(52 + payload.items.length * 38);
  page.drawText(labels.product, {
    x: margin,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(labels.quantity, {
    x: 332,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(labels.unitPrice, {
    x: 392,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(labels.tax, {
    x: 472,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  page.drawText(labels.total, {
    x: 520,
    y,
    size: 8,
    font: fonts.bold,
    color: muted,
  });
  y -= 12;
  page.drawLine({
    start: { x: margin, y },
    end: { x: A4.width - margin, y },
    thickness: 0.8,
    color: line,
  });
  y -= 18;
  for (const item of payload.items) {
    ensureSpace(40);
    const descriptionLines = wrapText(
      item.description,
      fonts.regular,
      8.5,
      276
    ).slice(0, 3);
    descriptionLines.forEach((text, index) =>
      page.drawText(text, {
        x: margin,
        y: y - index * 11,
        size: 8.5,
        font: fonts.regular,
        color: navy,
      })
    );
    page.drawText(formatNumber(item.quantity), {
      x: 340,
      y,
      size: 8.5,
      font: fonts.regular,
      color: navy,
    });
    page.drawText(formatMoney(item.unitPrice, payload.currency, language), {
      x: 392,
      y,
      size: 8.5,
      font: fonts.regular,
      color: navy,
    });
    page.drawText(`${formatNumber(payload.taxPercent)}%`, {
      x: 472,
      y,
      size: 8.5,
      font: fonts.regular,
      color: navy,
    });
    const itemTotal = item.quantity * item.unitPrice;
    const totalText = formatMoney(itemTotal, payload.currency, language);
    page.drawText(totalText, {
      x: A4.width - margin - fonts.regular.widthOfTextAtSize(totalText, 8.5),
      y,
      size: 8.5,
      font: fonts.regular,
      color: navy,
    });
    y -= Math.max(32, descriptionLines.length * 11 + 10);
    page.drawLine({
      start: { x: margin, y: y + 8 },
      end: { x: A4.width - margin, y: y + 8 },
      thickness: 0.6,
      color: line,
    });
  }

  ensureSpace(78);
  const totalsX = 335;
  const valueRight = A4.width - margin;
  const drawTotal = (label: string, value: string, bold = false) => {
    page.drawText(label, {
      x: totalsX,
      y,
      size: bold ? 11 : 8.5,
      font: bold ? fonts.bold : fonts.regular,
      color: navy,
    });
    page.drawText(value, {
      x:
        valueRight -
        (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(
          value,
          bold ? 11 : 8.5
        ),
      y,
      size: bold ? 11 : 8.5,
      font: bold ? fonts.bold : fonts.regular,
      color: navy,
    });
    y -= bold ? 18 : 15;
  };
  drawTotal(
    labels.excludingTax,
    formatMoney(subtotal, payload.currency, language)
  );
  drawTotal(
    labels.totalTax,
    formatMoney(taxAmount, payload.currency, language)
  );
  drawTotal(labels.amountDue, formatMoney(total, payload.currency, language), true);
  y -= 15;

  ensureSpace(80);
  page.drawText(labels.waysToPay, {
    x: margin,
    y,
    size: 14,
    font: fonts.bold,
    color: navy,
  });
  y -= 18;
  page.drawLine({
    start: { x: margin, y },
    end: { x: A4.width - margin, y },
    thickness: 0.8,
    color: line,
  });
  y -= 20;

  const paymentSections: Array<{ title: string; details: string }> = [];
  if (
    payload.paymentInstructions === 'national' ||
    payload.paymentInstructions === 'both'
  ) {
    paymentSections.push({
      title: labels.national,
      details: payload.nationalPaymentDetails,
    });
  }
  if (
    payload.paymentInstructions === 'international' ||
    payload.paymentInstructions === 'both'
  ) {
    paymentSections.push({
      title: labels.international,
      details: payload.internationalPaymentDetails,
    });
  }
  for (const section of paymentSections) {
    ensureSpace(55);
    page.drawText(section.title, {
      x: margin,
      y,
      size: 9,
      font: fonts.bold,
      color: navy,
    });
    y -= 15;
    if (section.details.trim()) {
      drawLines(section.details, {
        x: margin,
        maxWidth: contentWidth,
        size: 7.8,
        leading: 10.5,
        color: muted,
      });
    } else {
      page.drawText(
        language === 'pt'
          ? 'Preencha os dados bancários antes de emitir.'
          : 'Complete the bank details before issuing.',
        {
          x: margin,
          y,
          size: 7.8,
          font: fonts.regular,
          color: muted,
        }
      );
      y -= 10.5;
    }
    y -= 10;
  }

  if (payload.additionalInfo.trim()) {
    ensureSpace(45);
    page.drawText(labels.additional, {
      x: margin,
      y,
      size: 9,
      font: fonts.bold,
      color: navy,
    });
    y -= 15;
    drawLines(payload.additionalInfo, {
      x: margin,
      maxWidth: contentWidth,
      size: 7.8,
      leading: 10.5,
      color: muted,
    });
  }

  pages.forEach((currentPage, index) => {
    const footer = `${labels.page} ${index + 1} / ${pages.length} · ${payload.invoiceNumber}`;
    currentPage.drawText(safePdfText(footer), {
      x: margin,
      y: 34,
      size: 6.8,
      font: fonts.regular,
      color: muted,
    });
  });
  pdf.setTitle(`${labels.title} ${payload.invoiceNumber}`);
  pdf.setAuthor('P2L - Universidade de São Paulo');
  pdf.setCreator('P2L Laboratory OS');
  return new Uint8Array(await pdf.save());
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
  }).format(value);
}
