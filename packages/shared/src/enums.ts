import { z } from "zod";

export const SyncMode = z.enum(["auto", "manual", "stopped"]);
export type SyncMode = z.infer<typeof SyncMode>;

export const MachineStatus = z.enum(["online", "offline"]);
export type MachineStatus = z.infer<typeof MachineStatus>;
