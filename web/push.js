// Browser side of Web Push. Needs HTTPS (or localhost) and the service worker from sw.js.
import { api } from "./api.js";

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const b64ToBytes = s => {
  const raw = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("This browser doesn't support push notifications. (On iPhone, install the app to the Home Screen first.)");
  const reg = await navigator.serviceWorker.ready;
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Notifications are blocked. Allow them in the browser's site settings.");
  const { key } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
  await api.pushSubscribe(sub.toJSON(), deviceLabel());
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.pushUnsubscribe({ endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}
