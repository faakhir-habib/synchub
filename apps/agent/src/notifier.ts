// Native OS toast notifications, loaded lazily and fully fail-safe: if
// node-notifier is missing or the platform can't show a toast, it no-ops.
type NotifierModule = { notify(options: { title: string; message: string; timeout: number }): void };

let cached: NotifierModule | false | undefined; // undefined = not tried, false = unavailable

async function get(): Promise<NotifierModule | false> {
  if (cached !== undefined) return cached;
  try {
    cached = (await import("node-notifier")).default as unknown as NotifierModule;
  } catch {
    cached = false;
  }
  return cached;
}

export function createNotifier(enabled = true): { notify(title: string, message: string): void } {
  return {
    notify(title: string, message: string): void {
      if (!enabled) return;
      get()
        .then((n) => {
          if (n) n.notify({ title, message, timeout: 6 });
        })
        .catch(() => {
          /* never let a toast crash the agent */
        });
    },
  };
}
