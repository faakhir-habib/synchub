import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell.js";
import { Dashboard } from "./routes/Dashboard.js";
import { Projects } from "./routes/Projects.js";
import { ProjectDetail } from "./routes/ProjectDetail.js";
import { Machines } from "./routes/Machines.js";
import { Conflicts } from "./routes/Conflicts.js";
import { Notifications } from "./routes/Notifications.js";
import { Settings } from "./routes/Settings.js";
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
const projectDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: "/projects/$id",
  // Parses the route param and hands it to the (test-friendly, prop-driven)
  // ProjectDetail component. A non-numeric id becomes NaN here; ProjectDetail
  // treats that as not-found without ever calling the API (and separately
  // treats a 400 from the API — e.g. an out-of-range numeric id — as
  // not-found too), so no extra validation is needed on this side.
  component: function ProjectDetailRoute() {
    const { id } = projectDetailRoute.useParams();
    return <ProjectDetail projectId={Number(id)} />;
  },
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
    projectDetailRoute,
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
