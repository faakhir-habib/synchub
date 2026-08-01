import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./shell/AppShell.js";
import { Dashboard, Projects } from "./routes/Dashboard.js";

const rootRoute = createRootRoute({ component: () => <AppShell /> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Dashboard });
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: Projects,
});

const routeTree = rootRoute.addChildren([indexRoute, projectsRoute]);
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
