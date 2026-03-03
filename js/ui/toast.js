let container = null;

function ensureContainer() {
    if (container && document.body.contains(container)) return;
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
}

/**
 * Show a toast notification.
 * @param {string} message - Text to display
 * @param {object} [opts]
 * @param {"success"|"error"|"info"|"warning"} [opts.type="info"]
 * @param {number} [opts.duration=3500] - Auto-dismiss in ms (0 to keep open)
 */
export function showToast(message, { type = "info", duration = 3500 } = {}) {
    ensureContainer();

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.setAttribute("role", "alert");

    const icon = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" }[type] || "ℹ";

    toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" aria-label="Close">&times;</button>
  `;

    toast.querySelector(".toast-close").addEventListener("click", () => dismiss(toast));

    container.appendChild(toast);

    // Trigger entrance animation
    requestAnimationFrame(() => toast.classList.add("toast-show"));

    if (duration > 0) {
        setTimeout(() => dismiss(toast), duration);
    }

    return toast;
}

function dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.remove("toast-show");
    toast.classList.add("toast-hide");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    // Fallback removal if animation doesn't fire
    setTimeout(() => toast.remove(), 400);
}
