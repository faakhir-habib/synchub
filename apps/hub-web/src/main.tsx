import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { router } from "./router.js";
import { ThemeProvider, useTheme } from "./theme/theme-provider.js";
import { AuthProvider } from "./auth/auth-context.js";
import "./styles/index.css";

const queryClient = new QueryClient();

// Keeps the sonner toaster in sync with the app's own theme (dark/light/
// system) rather than sonner's own prefers-color-scheme detection.
function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors closeButton />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <ThemedToaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
