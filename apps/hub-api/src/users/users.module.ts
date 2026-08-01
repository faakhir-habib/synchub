import { Module } from "@nestjs/common";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";
import { AuthModule } from "../common/auth/auth.module.js";
import { CryptoModule } from "../common/crypto/crypto.module.js";

@Module({
  imports: [AuthModule, CryptoModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
