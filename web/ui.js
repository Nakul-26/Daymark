// Small DOM helpers. No framework: h(tag, props, ...children) builds elements.
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "selected" || k === "disabled") el[k] = !!v;
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// Bottom toast. toast("Deleted", { undo: fn }) shows an Undo button for 8s.
let toastEl, toastTimer, lastUndo;
export function toast(message, { undo, error } = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  lastUndo = undo ?? null;
  toastEl = h("div", { class: "toast" + (error ? " error" : ""), role: "status" }, h("span", {}, message),
    undo ? h("button", { onclick: () => { toastEl.remove(); undo(); } }, "Undo") : null,
    h("button", { class: "x", "aria-label": "Dismiss", onclick: () => toastEl.remove() }, "×"));
  document.body.append(toastEl);
  toastTimer = setTimeout(() => toastEl?.remove(), undo ? 8000 : 4000);
}

export const dismissToast = () => { toastEl?.remove(); lastUndo = null; };

// Ctrl+Z: run the Undo of the toast that's showing, if any.
export function undoLast() {
  if (!toastEl?.isConnected || !lastUndo) return false;
  const fn = lastUndo;
  toastEl.remove();
  lastUndo = null;
  fn();
  return true;
}

// Open a modal <dialog>. `build(close)` returns the dialog's content element.
export function modal(build, { onClose } = {}) {
  const dlg = h("dialog", {});
  const close = () => dlg.close();
  dlg.append(build(close));
  dlg.addEventListener("close", () => { dlg.remove(); onClose?.(); });
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }); // click on backdrop
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export const confirmBox = msg => confirm(msg);
export const isTyping = el => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el?.isContentEditable;
export const num = v => (Math.round(v * 100) / 100).toString();
