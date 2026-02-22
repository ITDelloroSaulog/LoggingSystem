export const MatterType = Object.freeze({
  LITIGATION: "litigation",
  SPECIAL_PROJECT: "special_project",
  RETAINER: "retainer",
});

export const ProspectStage = Object.freeze({
  LEAD: "lead",
  TOUCHPOINTS: "touchpoints",
  PROPOSAL: "proposal",
  SIGNED: "signed",
  ACQUIRED: "acquired",
  LOST: "lost",
});

export const EntryClass = Object.freeze({
  SERVICE: "service",
  OPEX: "opex",
  MEETING: "meeting",
  MISC: "misc",
  PROSPECT_COST: "prospect_cost",
});

export const ExpenseType = Object.freeze({
  COURIER: "courier",
  PRINTING: "printing",
  ENVELOPE: "envelope",
  TRANSPORT: "transport",
  NOTARY: "notary",
  MANHOUR: "manhour",
  MISC: "misc",
});

export const TASK_TO_EXPENSE_TYPE = Object.freeze({
  ope_lbc: ExpenseType.COURIER,
  ope_printing: ExpenseType.PRINTING,
  ope_envelope: ExpenseType.ENVELOPE,
  ope_transpo: ExpenseType.TRANSPORT,
  notary_fee: ExpenseType.NOTARY,
  ope_manhours: ExpenseType.MANHOUR,
});

export const TASK_DISPLAY_LABEL = Object.freeze({
  ope_lbc: "Courier",
});

export function normalizeMatterType(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("litig")) return MatterType.LITIGATION;
  if (raw.includes("special")) return MatterType.SPECIAL_PROJECT;
  if (raw.includes("retainer")) return MatterType.RETAINER;
  return raw.replace(/\s+/g, "_");
}

export function matterTypeLabel(rawValue) {
  const value = normalizeMatterType(rawValue);
  if (value === MatterType.LITIGATION) return "Litigation";
  if (value === MatterType.SPECIAL_PROJECT) return "Special Project";
  if (value === MatterType.RETAINER) return "Retainer";
  return rawValue || "-";
}
