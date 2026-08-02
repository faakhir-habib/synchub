import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MachineCreateRequest, type MachineWithToken } from "@synchub/shared";
import { Check, Copy, KeyRound } from "lucide-react";
import { createMachine } from "@/lib/endpoints";
import { qk } from "@/lib/query-keys";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface CreateMachineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Controlled "connect a machine" dialog — the direct-create path (name +
 * optional os/label, no pairing code). Two visual states: the form, and —
 * on success — a one-time token reveal, since `MachineWithToken.token` is
 * never returned again after this response. Task 5's pairing-code flow will
 * hang a "Pair instead" entry point off the same trigger in Machines.tsx;
 * this component only owns the direct-create half.
 */
export function CreateMachineDialog({ open, onOpenChange }: CreateMachineDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [os, setOs] = useState("");
  const [label, setLabel] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<MachineWithToken | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: createMachine,
    onSuccess: (machine) => {
      // The list (and the dashboard's machine count) should reflect the new
      // machine right away — the dialog itself stays open to reveal the
      // one-time token, but there's no reason to make the list wait for it.
      queryClient.invalidateQueries({ queryKey: qk.machines });
      queryClient.invalidateQueries({ queryKey: qk.dashboardMetrics });
      toast.success("Machine connected");
      setCreated(machine);
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    },
  });

  function reset() {
    setName("");
    setOs("");
    setLabel("");
    setFieldError(null);
    setFormError(null);
    setCreated(null);
    setCopied(false);
    mutation.reset();
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = MachineCreateRequest.safeParse({
      name: name.trim(),
      os: os.trim() || undefined,
      label: label.trim() || undefined,
    });
    if (!parsed.success) {
      setFieldError("Enter a machine name.");
      return;
    }
    setFieldError(null);
    mutation.mutate(parsed.data);
  }

  async function handleCopy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select and copy the token manually.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Machine connected</DialogTitle>
              <DialogDescription>
                Paste this token into the agent&rsquo;s config on <strong>{created.name}</strong> to
                finish setup.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/50 px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                  {created.token}
                </code>
                <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
              >
                <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>Save this token now &mdash; you won&rsquo;t be able to see it again.</span>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <DialogHeader>
              <DialogTitle>Connect a machine</DialogTitle>
              <DialogDescription>
                Register a machine directly and get a one-time token for its agent config.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-5 space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {formError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="machine-name">Name</Label>
                <Input
                  id="machine-name"
                  autoFocus
                  autoComplete="off"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (fieldError) setFieldError(null);
                  }}
                  placeholder="e.g. atlas-laptop"
                  aria-invalid={fieldError ? true : undefined}
                />
                {fieldError && <p className="text-xs text-destructive">{fieldError}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="machine-os">OS (optional)</Label>
                  <Input
                    id="machine-os"
                    autoComplete="off"
                    value={os}
                    onChange={(e) => setOs(e.target.value)}
                    placeholder="macOS"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="machine-label">Label (optional)</Label>
                  <Input
                    id="machine-label"
                    autoComplete="off"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Work laptop"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Connecting…" : "Connect machine"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
