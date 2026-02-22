function el(tag, className, text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function openModalFrame({
  title = "Confirm",
  message = "",
  cancelable = true,
}) {
  const activeBefore = document.activeElement;
  const overlay = el("div", "ui-modal-overlay");
  const modal = el("div", "ui-modal");
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);

  const head = el("div", "ui-modal-head");
  head.appendChild(el("h3", "ui-modal-title", title));

  const body = el("div", "ui-modal-body");
  if (message) {
    const msg = el("div", "ui-modal-message");
    msg.textContent = message;
    body.appendChild(msg);
  }

  const error = el("div", "ui-modal-error");
  error.style.display = "none";
  body.appendChild(error);

  const actions = el("div", "ui-modal-actions");
  modal.appendChild(head);
  modal.appendChild(body);
  modal.appendChild(actions);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function setError(text) {
    error.textContent = text || "";
    error.style.display = text ? "block" : "none";
  }

  function close() {
    overlay.remove();
    if (activeBefore && typeof activeBefore.focus === "function") {
      activeBefore.focus();
    }
    window.removeEventListener("keydown", onEsc);
  }

  function onEsc(evt) {
    if (evt.key === "Escape" && cancelable) {
      evt.preventDefault();
      onCancel?.();
    }
  }

  let onCancel = null;
  window.addEventListener("keydown", onEsc);
  if (cancelable) {
    overlay.addEventListener("click", (evt) => {
      if (evt.target === overlay) onCancel?.();
    });
  }

  return {
    overlay,
    modal,
    body,
    actions,
    close,
    setError,
    setOnCancel(fn) {
      onCancel = fn;
    },
  };
}

export function uiAlert({
  title = "Notice",
  message = "",
  okText = "OK",
} = {}) {
  return new Promise((resolve) => {
    const frame = openModalFrame({ title, message, cancelable: true });
    const okBtn = el("button", "btn btn-primary", okText);
    okBtn.type = "button";
    okBtn.addEventListener("click", () => {
      frame.close();
      resolve();
    });
    frame.setOnCancel(() => {
      frame.close();
      resolve();
    });
    frame.actions.appendChild(okBtn);
    okBtn.focus();
  });
}

export function uiConfirm({
  title = "Confirm",
  message = "",
  confirmText = "Confirm",
  cancelText = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const frame = openModalFrame({ title, message, cancelable: true });
    const cancelBtn = el("button", "btn", cancelText);
    cancelBtn.type = "button";
    const confirmBtn = el("button", danger ? "btn btn-danger" : "btn btn-primary", confirmText);
    confirmBtn.type = "button";

    cancelBtn.addEventListener("click", () => {
      frame.close();
      resolve(false);
    });
    confirmBtn.addEventListener("click", () => {
      frame.close();
      resolve(true);
    });
    frame.setOnCancel(() => {
      frame.close();
      resolve(false);
    });

    frame.actions.append(cancelBtn, confirmBtn);
    cancelBtn.focus();
  });
}

export function uiPrompt({
  title = "Input Required",
  message = "",
  placeholder = "",
  defaultValue = "",
  label = "Value",
  required = false,
  confirmText = "Save",
  cancelText = "Cancel",
  danger = false,
  validate = null,
} = {}) {
  return new Promise((resolve) => {
    const frame = openModalFrame({ title, message, cancelable: true });
    const fieldWrap = el("label", "ui-modal-field");
    fieldWrap.appendChild(el("span", "ui-modal-field-label", label));
    const input = el("input", "ui-modal-input");
    input.type = "text";
    input.placeholder = placeholder;
    input.value = defaultValue || "";
    fieldWrap.appendChild(input);
    frame.body.appendChild(fieldWrap);

    const cancelBtn = el("button", "btn", cancelText);
    cancelBtn.type = "button";
    const confirmBtn = el("button", danger ? "btn btn-danger" : "btn btn-primary", confirmText);
    confirmBtn.type = "button";

    function validateInput() {
      const value = String(input.value || "");
      if (required && !value.trim()) {
        frame.setError("This field is required.");
        confirmBtn.disabled = true;
        return;
      }
      if (typeof validate === "function") {
        const err = validate(value);
        if (err) {
          frame.setError(String(err));
          confirmBtn.disabled = true;
          return;
        }
      }
      frame.setError("");
      confirmBtn.disabled = false;
    }

    cancelBtn.addEventListener("click", () => {
      frame.close();
      resolve(null);
    });
    confirmBtn.addEventListener("click", () => {
      validateInput();
      if (confirmBtn.disabled) return;
      frame.close();
      resolve(String(input.value || ""));
    });
    input.addEventListener("input", validateInput);
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        confirmBtn.click();
      }
    });

    frame.setOnCancel(() => {
      frame.close();
      resolve(null);
    });
    frame.actions.append(cancelBtn, confirmBtn);
    input.focus();
    input.select?.();
    validateInput();
  });
}
