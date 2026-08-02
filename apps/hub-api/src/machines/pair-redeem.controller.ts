import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { MachinesService } from "./machines.service.js";
import { zodBody } from "../common/validation/zod.pipe.js";
import { PairRedeemRequest } from "@synchub/shared";

// Ports legacy hub/src/routes/machines.js#pairRedeemRoutes, mounted at
// /api/agent (global "api" prefix). Deliberately unauthenticated: the agent
// has no machine token yet at this point — the pairing code IS the credential.
@Controller("agent")
export class PairRedeemController {
  constructor(private readonly machines: MachinesService) {}

  @Post("pair/redeem")
  @HttpCode(201)
  redeem(@Body(zodBody(PairRedeemRequest)) body: PairRedeemRequest, @Req() req: Request) {
    return this.machines.redeemPairingCode(body, req.ip ?? null);
  }
}
