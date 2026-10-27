// Settings: timezone, reminder behaviour, push on this device, backups/export, sign out.
import { h, toast } from "../ui.js";
import { state, render } from "../state.js";
import { actions } from "../actions.js";
import { api } from "../api.js";
import { pushSupported, currentSubscription, enablePush, disablePush } from "../push.js";

let pushOn = null, subs = [], backups = [];
async function refreshExtra() {
  [pushOn, subs, backups] = await Promise.all([currentSubscription().then(Boolean), api.pushSubs().catch(() => []), api.backups().catch(() => [])]);
  render();
}

export function renderSettings() {
  if (pushOn === null) refreshExtra();
  const s = state.settings;
  const save = patch => actions.saveSettings(patch);
  const field = (label, el, hint) => h("label", { class: "field" }, h("span", {}, label), el, hint && h("small", { class: "muted" }, hint));
  const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [s.timezone];
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const tz = h("select", { onchange: e => save({ timezone: e.target.value }) }, [...new Set([s.timezone, ...zones])].map(z => h("option", { value: z, selected: z === s.timezone }, z)));

  return h("div", { class: "settings" },
    h("header", {}, h("button", { class: "burger", onclick: () => { state.menu = !state.menu; render(); } }, "☰"), h("h2", { class: "grow" }, "Settings")),

    h("section", { class: "group" }, h("h3", {}, "Time"),
      field("Timezone", tz, s.timezone !== device ? `This device is in ${device}.` : null),
      s.timezone !== device && h("button", { onclick: () => save({ timezone: device }) }, `Use ${device}`)),

    h("section", { class: "group" }, h("h3", {}, "Reminders"),
      field("Reminder time for tasks with a date but no time", h("input", { type: "time", value: s.default_reminder_time, onchange: e => e.target.value && save({ default_reminder_time: e.target.value }) })),
      field("Drop missed reminders older than (hours)", h("input", { type: "number", min: 1, max: 999, value: s.catch_up_hours, class: "narrow", onchange: e => save({ catch_up_hours: e.target.value }) }),
        "After the server was off, reminders that became due within this window are still delivered; older ones are skipped."),
      h("label", { class: "check-row" }, h("input", { type: "checkbox", checked: s.daily_summary === "on", onchange: e => save({ daily_summary: e.target.checked ? "on" : "off" }) }), "Daily summary notification"),
      s.daily_summary === "on" && field("Send at", h("input", { type: "time", value: s.summary_time, onchange: e => e.target.value && save({ summary_time: e.target.value }) }))),

    h("section", { class: "group" }, h("h3", {}, "Push notifications"),
      !pushSupported()
        ? h("p", { class: "muted" }, "Not supported in this browser. In-app notifications still work.")
        : h("div", { class: "row" },
          pushOn
            ? [h("span", {}, "✅ Enabled on this device"), h("button", { onclick: async () => { await disablePush(); await refreshExtra(); } }, "Turn off"),
              h("button", { onclick: async () => { try { await api.pushTest(); toast("Test sent"); } catch (e) { toast(e.message, { error: true }); } } }, "Send test")]
            : [h("button", { class: "primary", onclick: async () => { try { await enablePush(); toast("Push enabled"); await refreshExtra(); } catch (e) { toast(e.message, { error: true }); } } }, "Enable on this device")]),
      !location.protocol.startsWith("https") && location.hostname !== "localhost" && h("p", { class: "hint" }, "Push needs HTTPS. Open the app through your secure URL."),
      subs.length > 0 && h("ul", { class: "plain" }, subs.map(d => h("li", { class: "row" }, h("span", { class: "grow" }, `${d.label || "Device"} · added ${d.created_at.slice(0, 10)}`),
        h("button", { class: "danger", onclick: async () => { await api.pushUnsubscribe({ id: d.id }); await refreshExtra(); } }, "Remove"))))),

    h("section", { class: "group" }, h("h3", {}, "Data"),
      h("p", { class: "muted" }, "A backup of the database is made every day (last 14 kept) in the server's data/backups folder. Copy it somewhere else too."),
      h("div", { class: "row" },
        h("button", { onclick: async () => { try { const r = await api.backupNow(); toast("Backup created: " + r.created); await refreshExtra(); } catch (e) { toast(e.message, { error: true }); } } }, "Back up now"),
        h("a", { class: "btn", href: "/api/export", download: "daymark-export.json" }, "Download all data (JSON)")),
      backups.length > 0 && h("small", { class: "muted" }, `Latest backup: ${backups[0].name} (${Math.round(backups[0].size / 1024)} KB)`)),

    state.authEnabled && h("section", { class: "group" }, h("button", { onclick: () => document.dispatchEvent(new Event("daymark:logout")) }, "Sign out")));
}
