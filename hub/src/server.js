import { createApp } from "./app.js";

const port = process.env.PORT || 8080;
const app = createApp();
const server = app.listen(port, () => console.log(`SyncHub Hub on :${port}`));
app.locals.realtime.attach(server);
