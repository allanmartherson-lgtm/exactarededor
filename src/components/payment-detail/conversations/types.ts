// Shared types for the chat-style Conversations panel.

export type Role = "analista" | "validador" | "diretor" | "admin";

export type MessageRow = {
  id: string;
  payment_id: string;
  company_group_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  author_type: "interno" | "empresa";
  message: string;
  status: "pendente" | "respondida" | "encerrada";
  assigned_to: string | null;
  hospital_id: string | null;
  created_at: string;
};

export type ReadRow = {
  message_id: string;
  user_id: string;
  read_at: string;
};

export type AttachmentRow = {
  id: string;
  question_id: string;
  payment_id: string;
  author_id: string | null;
  author_name: string | null;
  author_type: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export type EventType =
  | "opened"
  | "assigned"
  | "reassigned"
  | "unassigned"
  | "closed"
  | "reopened"
  | "answered";

export type EventRow = {
  id: string;
  thread_root_id: string;
  payment_id: string;
  event_type: EventType;
  actor_id: string | null;
  actor_name: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Thread = {
  root: MessageRow;
  replies: MessageRow[];
  events: EventRow[];
  attachmentsByMessage: Record<string, AttachmentRow[]>;
  /** msgs not authored by me and without a read row for me */
  unreadForMe: number;
  /** all participants involved */
  participantIds: Set<string>;
  lastActivityAt: string;
};

export type Group = { id: string; company_name: string };

/** Strip [role]/[empresa] prefixes from legacy formatted messages. */
export function stripPrefixes(raw: string): { body: string; roleTag?: string; groupTag?: string } {
  let body = raw;
  let roleTag: string | undefined;
  let groupTag: string | undefined;
  const roleMatch = body.match(/^\[(analista|validador|diretor|admin|interno|empresa)\]\s*/i);
  if (roleMatch) {
    roleTag = roleMatch[1].toLowerCase();
    body = body.slice(roleMatch[0].length);
  }
  const groupMatch = body.match(/^\[([^\]]+)\]\s*/);
  if (groupMatch) {
    groupTag = groupMatch[1];
    body = body.slice(groupMatch[0].length);
  }
  return { body, roleTag, groupTag };
}

export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase() || "??";
}

/** Deterministic color hash from a string → one of N classes. */
export function avatarHueClass(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const palette = [
    "bg-[hsl(213_70%_50%)] text-white",
    "bg-[hsl(280_55%_50%)] text-white",
    "bg-[hsl(160_55%_38%)] text-white",
    "bg-[hsl(28_85%_50%)] text-white",
    "bg-[hsl(340_70%_50%)] text-white",
    "bg-[hsl(190_70%_42%)] text-white",
  ];
  return palette[h % palette.length];
}
