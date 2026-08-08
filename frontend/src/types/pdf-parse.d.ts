declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }

  export default function pdfParse(
    data: Buffer,
    options?: Record<string, unknown>
  ): Promise<PdfParseResult>;
}
