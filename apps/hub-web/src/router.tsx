import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Projects, Machines, Conflicts, Notifications, Settings } from "./routes/Placeholders.js";
import { AuthGuard } from "./auth/AuthGuard.js";
import { Login } from "./auth/Login.js";
import { Signup } from "./auth/Signup.js";
import { RealtimeProvider } from "./realtime/realtime-provider.js";

const rootRoute = createRootRoute({ component: () => <Outlet /> });

// Pathless layout route: every "inside the app" screen is a child of this
// route, so it's guarded by AuthGuard and wrapped in the persistent
// AppShell. /login and /signup are siblings of this route (not children),
// so they render full-screen, without the shell and without the guard.
const appLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_app",
  component: () => (
    <AuthGuard>
      <RealtimeProvider>
        <AppShell />
      </RealtimeProvider>
    </AuthGuard>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/",
  component: Dashboard,
});
const projectsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/projects",
  component: Projects,
});
const machinesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/machines",
  component: Machines,
});
const conflictsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/conflicts",
  component: Conflicts,
});
const notificationsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/notifications",
  component: Notifications,
});
const settingsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/settings",
  component: Settings,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: Login,
});
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: Signup,
});

const routeTree = rootRoute.addChildren([
  appLayoutRoute.addChildren([
    indexRoute,
    projectsRoute,
    machinesRoute,
    conflictsRoute,
    notificationsRoute,
    settingsRoute,
  ]),
  loginRoute,
  signupRoute,
]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
