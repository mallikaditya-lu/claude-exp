// Board context: research, briefs and documents that Claude reads together with a board.
// A context document is either text (pasted, or saved by Claude through the connector) or an
// uploaded file: text-like files are read as text, PDFs are handed to Claude as documents.

export const MAX_CONTEXT_CHARS = 400_000; // per text document
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const TEXT_FILE = /\.(md|markdown|txt|text|csv|tsv|json|html?|xml|ya?ml|rtf)$/i;

/** 'text' | 'pdf' | null (not something Claude can read) for an uploaded file. */
export function fileKind(name = '', mime = '') {
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('text/') || /json|xml|yaml|csv/.test(mime) || TEXT_FILE.test(name)) return 'text';
  return null;
}

/** What lists show: everything but the text itself (plus a short preview). */
export function contextMeta(d) {
  const { text, ...rest } = d;
  return { ...rest, ...(text ? { chars: text.length, preview: text.slice(0, 280) } : {}) };
}

/** The text of a context document (files are read from storage). PDFs return null. */
export async function contextText(doc, files) {
  if (doc.kind === 'text') return doc.text || '';
  const kind = fileKind(doc.name, doc.mime);
  if (kind !== 'text' || !doc.url?.startsWith('/uploads/')) return null;
  const buf = await files.read(doc.url.split('/').pop(), 8 * 1024 * 1024);
  return buf.toString('utf8').slice(0, MAX_CONTEXT_CHARS);
}

/** A PDF context document as base64, for Claude's document input. */
export async function contextPdf(doc, files) {
  if (doc.kind !== 'file' || fileKind(doc.name, doc.mime) !== 'pdf' || !doc.url?.startsWith('/uploads/')) return null;
  return (await files.read(doc.url.split('/').pop(), MAX_PDF_BYTES)).toString('base64');
}
