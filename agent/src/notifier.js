// Native OS toast notifications, loaded lazily and fully fail-safe: if
// node-notifier is missing or the platform can't show a toast, it no-ops.
let cached; // undefined = not tried, false = unavailable, object = module

async function get() {
  if (cached !== undefined) return cached;
  try { cached = (await import("node-notifier")).default; }
  catch { cached = false; }
  return cached;
}

export function createNotifier(enabled = true) {
  return {
    async notify(title, message) {
      if (!enabled) return;
      try {
        const n = await get();
        if (n) n.notify({ title, message, timeout: 6 });
      } catch { /* never let a toast crash the agent */ }
    },
  };
}
