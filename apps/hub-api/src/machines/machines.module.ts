import { Module } from "@nestjs/common";
import { MachinesController } from "./machines.controller.js";
import { PairRedeemController } from "./pair-redeem.controller.js";
import { MachinesService } from "./machines.service.js";
import { AuthModule } from "../common/auth/auth.module.js";
import { CryptoModule } from "../common/crypto/crypto.module.js";

@Module({
  imports: [AuthModule, CryptoModule],
  controllers: [MachinesController, PairRedeemController],
  providers: [MachinesService],
})
export class MachinesModule {}
