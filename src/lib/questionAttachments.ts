/**
 * Regras compartilhadas para anexos da conversa de NF (recebedor x analista).
 * Mantém UI (portal e painel) e edge functions sincronizados em tipos/limites.
 */

export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const MAX_EMAIL_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024; // limite do Resend

export const ALLOWED_ATTACHMENT_MIMES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.gif,.webp,.xls,.xlsx,.csv";

export interface AttachmentValidationError {
  file: string;
  reason: "size" | "mime" | "empty";
}

export const validateAttachment = (file: { name: string; size: number; type: string }): AttachmentValidationError | null => {
  if (!file.size) return { file: file.name, reason: "empty" };
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) return { file: file.name, reason: "size" };
  // Alguns navegadores enviam '' como type pra .xlsx/.csv — usa fallback por extensão.
  const mime = (file.type || "").toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_MIMES.has(mime)) return null;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const okByExt = ["pdf", "jpg", "jpeg", "png", "gif", "webp", "xls", "xlsx", "csv"].includes(ext);
  if (okByExt) return null;
  return { file: file.name, reason: "mime" };
};

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

export interface QuestionAttachment {
  id: string;
  question_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}