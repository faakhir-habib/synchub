import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { pairMachine } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface PairMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Status = "loading" | "ready" | "expired" | "error";

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Controlled "pair a machine" dialog — the code-based connect path.
 * Generates a one-time, single-use code on open (or on demand once it
 * expires) via `pairMachine()`, and lets the agent CLI on the target
 * machine redeem it — the machine itself appears in the list once the
 * agent completes the pairing and presence lights it up, not from this
 * dialog. Siblings with `CreateMachineDialog`, which owns the direct-create
 * half of the same "Connect machine" affordance.
 */
export function PairMachineDialog({ open, onOpenChange }: PairMachineDialogProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status>("loading");
  const [code, setCode] = useState<string | null>(null);
  const [expiresInTotal, setExpiresInTotal] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTimer() {
    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  async function generate() {
    clearTimer();
    setStatus("loading");
    setErrorMessage(null);
    setCodeCopied(false);
    setCommandCopied(false);
    try {
      const res = await pairMachine();
      setCode(res.code);
      setExpiresInTotal(res.expires_in);
      setRemaining(res.expires_in);
      setStatus("ready");
      intervalRef.current = setInterval(() => {
        setRemaining((r) => Math.max(0, r - 1));
      }, 1000);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    }
  }

  const wasOpenRef = useRef(open);

  // Kick off (or reset) generation whenever the dialog opens; tear the
  // ticking interval down whenever it closes or unmounts so it never leaks.
  // A close — by any path: Escape, overlay click, the X button, or the
  // parent flipping `open` itself — also invalidates the machines list,
  // since a pairing redeemed while this was open only shows up as a new
  // row after a refetch (presence then lights it up live).
  useEffect(() => {
    if (open) {
      void generate();
    } else {
      clearTimer();
      if (wasOpenRef.current) {
        queryClient.invalidateQueries({ queryKey: qk.machines });
      }
    }
    wasOpenRef.current = open;
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The countdown hits zero on its own timeline — flip to "expired" here
  // rather than inside the interval's state updater, which must stay pure.
  useEffect(() => {
    if (status === "ready" && remaining <= 0) {
      clearTimer();
      setStatus("expired");
    }
  }, [remaining, status]);

  const hubUrl = typeof window !== "undefined" ? window.location.origin : "<hub-url>";
  const command = code ? `synchub-agent pair ${code} ${hubUrl}` : "";

  async function copyText(text: string, onCopied: (copied: boolean) => void) {
    try {
      await navigator.clipboard.writeText(text);
      onCopied(true);
      window.setTimeout(() => onCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy it manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pair a machine</DialogTitle>
          <DialogDescription>
            Generate a one-time code, then redeem it from the agent on the machine you want to
            connect.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5">
          {status === "loading" && (
            <div className="flex flex-col items-center justify-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Generating code&hellip;</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="h-5 w-5" />
              </span>
              <p role="alert" className="text-sm text-destructive">
                {errorMessage}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void generate()}>
                <RotateCw className="h-3.5 w-3.5" />
                Try again
              </Button>
            </div>
          )}

          {(status === "ready" || status === "expired") && code && (
            <div className="space-y-5">
              <div className="rounded-xl border border-border bg-muted/40 px-6 py-5 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Pairing code
                </p>

                <div
                  className={
                    "mt-3 select-all font-mono text-4xl font-bold tracking-[0.35em] text-foreground transition-opacity" +
                    (status === "expired" ? " opacity-40" : "")
                  }
                >
                  {code}
                </div>

                <div className="mt-4 flex items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(code, setCodeCopied)}
                  >
                    {codeCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {codeCopied ? "Copied" : "Copy code"}
                  </Button>
                </div>

                {status === "ready" ? (
                  <p className="mt-4 font-mono text-sm text-muted-foreground">
                    Expires in <span className="text-foreground">{formatCountdown(remaining)}</span>
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col items-center gap-2.5">
                    <p className="text-sm font-medium text-muted-foreground">Code expired</p>
                    <Button type="button" size="sm" onClick={() => void generate()}>
                      <RotateCw className="h-3.5 w-3.5" />
                      Generate new code
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  On the machine you want to connect, install the agent and run:
                </p>
                <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5">
                  <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-foreground">
                    {command}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(command, setCommandCopied)}
                  >
                    {commandCopied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {commandCopied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                This code expires in {Math.round(expiresInTotal / 60)} minutes and can be used once.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
