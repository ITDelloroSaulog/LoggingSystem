/**
 * Shared utility functions used across multiple page modules.
 * Import from here instead of re-declaring in each page file.
 */

/**
 * Trim and stringify a value. Returns empty string for null/undefined.
 */
export function clean(v) {
    return String(v || "").trim();
}

/**
 * Format a number as Philippine Peso with 2 decimal places.
 */
export function fmtPeso(n) {
    return Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

/**
 * Format a number as Philippine Peso with 0 decimal places.
 */
export function fmtPesoShort(n) {
    return Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

/**
 * Format a date value as a localized date string.
 */
export function fmtDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
}

/**
 * Format a date value as a localized date+time string.
 */
export function fmtDateTime(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Get a CSS class for a status pill based on the status string.
 */
export function statusPillClass(status) {
    const s = clean(status).toLowerCase();
    if (s === "approved") return "status-pill approved";
    if (s === "pending" || s.startsWith("pending")) return "status-pill pending";
    if (s === "billed" || s === "completed") return "status-pill completed";
    if (s === "rejected") return "status-pill rejected";
    return "status-pill";
}

/**
 * Extract retainer assignee from task_category + description pipe-map.
 */
export function extractRetainerAssignee(taskCategory, description) {
    const task = clean(taskCategory).toLowerCase();
    if (!task.startsWith("retainer_")) return "";
    const match = String(description || "").match(/Assignee:\s*([^|]+)/i);
    const value = clean(match?.[1] || "");
    if (!value || /^(-|n\/a|na)$/i.test(value)) return "";
    return value;
}

/**
 * Parse a pipe-delimited "Key: Value" string into an object.
 */
export function parsePipeMap(description) {
    const map = {};
    const parts = String(description || "")
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean);

    for (const part of parts) {
        const idx = part.indexOf(":");
        if (idx <= 0) continue;
        const key = part.slice(0, idx).trim().toLowerCase();
        map[key] = part.slice(idx + 1).trim();
    }
    return map;
}

/**
 * Sanitize a filename for safe storage use.
 */
export function safeFileName(name, fallback = "file.pdf") {
    return String(name || fallback)
        .replace(/[^\w.\-() ]+/g, "_")
        .slice(0, 100);
}
