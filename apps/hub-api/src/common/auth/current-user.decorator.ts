import { createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

// Populated by SessionAuthGuard.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: unknown }>();
  return req.user;
});

// Populated by MachineAuthGuard.
export const CurrentMachine = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { machine?: unknown }>();
  return req.machine;
});
