import { Action, Confidence, Status } from "./types";

export const ACTION_META: Record<Action, { label: string; color: string }> = {
  represent: { label: "Represent", color: "var(--green)" },
  accept_liability: { label: "Accept liability", color: "var(--red)" },
  request_more_evidence: { label: "Request evidence", color: "var(--amber)" },
};

export const STATUS_META: Record<Status, { label: string; color: string }> = {
  satisfied: { label: "SATISFIED", color: "var(--green)" },
  partial: { label: "PARTIAL", color: "var(--amber)" },
  missing: { label: "MISSING", color: "var(--red)" },
};

export const CONF_COLOR: Record<Confidence, string> = {
  high: "var(--green)",
  medium: "var(--amber)",
  low: "var(--red)",
};

export function firstSentence(text: string): string {
  const idx = text.indexOf(". ");
  return idx === -1 ? text : text.slice(0, idx + 1);
}
