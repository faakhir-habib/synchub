import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WsMessage } from "@synchub/shared";
import { openRealtimeSocket, type RealtimeSocket } from "../lib/ws.js";
import { setPresence } from "./presence-store.js";
import { setProgress, clearProgress } from "./progress-store.js";
import { qk } from "../lib/query-keys.js";
import { useAuth } from "../auth/auth-context.js";

export type RealtimeStatus = "connected" | "reconnecting" | "idle";

const RealtimeStatusContext = createContext<RealtimeStatus>("idle");

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeStatusContext);
}

const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

function dispatch(msg: WsMessage, queryClient: QueryClient): void {
  switch (msg.type) {
    case "presence":
      setPresence(msg.machineId, { status: msg.status, lastSeenAt: msg.lastSeenAt });
      queryClient.invalidateQueries({ queryKey: qk.machines });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      return;

    case "changed":
      queryClient.invalidateQueries({ queryKey: qk.project(msg.projectId) });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: qk.activity });
      return;

    case "deleted":
      queryClient.invalidateQueries({ queryKey: qk.project(msg.projectId) });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: qk.activity });
      return;

    case "sync-progress":
      // Transient per-file progress — drives the live indicator on Project
      // Detail via progress-store (module-level, outside the query cache).
      setProgress(msg.projectId, {
        machineId: msg.machineId,
        filename: msg.filename,
        completed: msg.completed,
        total: msg.total,
        phase: msg.phase,
      });
      return;

    case "sync-complete":
      clearProgress(msg.projectId);
      queryClient.invalidateQueries({ queryKey: qk.project(msg.projectId) });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      queryClient.invalidateQueries({ queryKey: qk.activity });
      return;

    case "notification":
      toast(msg.notification.title);
      queryClient.invalidateQueries({ queryKey: qk.notifications });
      return;

    case "welcome":
    case "sync-trigger":
      // Agent/handshake-directed — nothing for the browser to act on.
      return;

    default: {
      // Exhaustiveness guard: if WsMessage gains a new variant, this fails
      // to compile until a case is added above.
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

/**
 * Owns the single live WebSocket connection for the authed session: opens it
 * once a token is available, dispatches incoming frames to the query cache /
 * presence store / toasts, and reconnects with capped exponential backoff on
 * drop. Must be mounted inside AuthGuard (needs `token`).
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>("idle");

  // Refs, not state — the timer/attempt/socket must survive re-renders
  // without re-triggering the effect, and must be readable/clearable from
  // the effect's cleanup on unmount.
  const socketRef = useRef<RealtimeSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const tornDownRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("idle");
      return;
    }

    tornDownRef.current = false;

    const connect = () => {
      socketRef.current = openRealtimeSocket({
        token,
        onOpen: () => {
          if (tornDownRef.current) return;
          attemptRef.current = 0;
          setStatus("connected");
          // Catch-up: we may have missed events while disconnected (or this
          // is the very first connect) — refetch everything currently
          // mounted rather than trying to reconcile individual messages.
          queryClient.invalidateQueries();
        },
        onMessage: (msg) => {
          if (tornDownRef.current) return;
          dispatch(msg, queryClient);
        },
        onClose: () => {
          if (tornDownRef.current) return;
          setStatus("reconnecting");
          const attempt = attemptRef.current;
          attemptRef.current = attempt + 1;
          const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
          timerRef.current = setTimeout(() => {
            if (tornDownRef.current) return;
            connect();
          }, delay);
        },
      });
    };

    connect();

    return () => {
      tornDownRef.current = true;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      socketRef.current?.close();
      socketRef.current = null;
      attemptRef.current = 0;
    };
  }, [token, queryClient]);

  return (
    <RealtimeStatusContext.Provider value={status}>{children}</RealtimeStatusContext.Provider>
  );
}
