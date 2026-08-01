import { useState, type FormEvent } from "react";
import { useNavigate, Link, Navigate } from "@tanstack/react-router";
import { LoginRequest } from "@synchub/shared";
import { useAuth } from "./auth-context.js";
import { ApiError } from "../lib/api-error.js";
import { collectFieldErrors } from "./validation.js";
import { AuthLayout } from "./AuthLayout.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

export function Login() {
  const { login, token } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Already signed in (e.g. direct nav to /login) — bounce home.
  if (token) return <Navigate to="/" />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const parsed = LoginRequest.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(collectFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      await login(parsed.data.email, parsed.data.password);
      navigate({ to: "/" });
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card className="w-full border-border/60 shadow-xl shadow-primary/5">
        <CardHeader className="space-y-1.5 text-center">
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to keep your projects in sync.</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit} noValidate>
          <CardContent className="space-y-4">
            {formError && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email ? true : undefined}
              />
              {fieldErrors.email && (
                <p className="text-xs text-destructive">{fieldErrors.email}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors.password ? true : undefined}
              />
              {fieldErrors.password && (
                <p className="text-xs text-destructive">{fieldErrors.password}</p>
              )}
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              New to SyncHub?{" "}
              <Link to="/signup" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </AuthLayout>
  );
}
