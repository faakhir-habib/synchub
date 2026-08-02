import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { UsersService } from "./users.service.js";
import { SessionAuthGuard } from "../common/auth/session-auth.guard.js";
import { CurrentUser } from "../common/auth/current-user.decorator.js";
import { zodBody } from "../common/validation/zod.pipe.js";
import {
  LoginRequest,
  ProfileUpdateRequest,
  SignupRequest,
  WebhookUpdateRequest,
} from "@synchub/shared";

// Ports legacy hub/src/routes/auth.js, mounted at /api/auth (global "api" prefix).
@Controller("auth")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post("signup")
  @HttpCode(201)
  signup(@Body(zodBody(SignupRequest)) body: SignupRequest) {
    return this.users.signup(body);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body(zodBody(LoginRequest)) body: LoginRequest) {
    return this.users.login(body);
  }

  @UseGuards(SessionAuthGuard)
  @Post("logout")
  @HttpCode(200)
  logout(@Req() req: Request & { sessionToken?: string }) {
    return this.users.logout(req.sessionToken ?? "");
  }

  @UseGuards(SessionAuthGuard)
  @Get("me")
  me(@CurrentUser() user: User) {
    return this.users.me(user);
  }

  @UseGuards(SessionAuthGuard)
  @Put("me")
  updateMe(
    @CurrentUser() user: User,
    @Body(zodBody(ProfileUpdateRequest)) body: ProfileUpdateRequest,
  ) {
    return this.users.updateProfile(user.id, body);
  }

  @UseGuards(SessionAuthGuard)
  @Put("me/notify-webhook")
  updateWebhook(
    @CurrentUser() user: User,
    @Body(zodBody(WebhookUpdateRequest)) body: WebhookUpdateRequest,
  ) {
    return this.users.setWebhook(user.id, body.url);
  }
}
