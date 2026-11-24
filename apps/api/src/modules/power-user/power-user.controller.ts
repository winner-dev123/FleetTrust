import type { User } from "@fleettrust/db";
import type { MyPowerUserDto, UserStatusDto } from "@fleettrust/types";
import {
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  type PipeTransform,
  Post,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { CurrentUser, Public } from "../identity/index.js";
import { PowerUserService } from "./power-user.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** Your Power User status, what counts, and claiming it once you qualify (SRS F-160). */
@Controller("v1/me/power-user")
export class MyPowerUserController {
  constructor(private readonly powerUsers: PowerUserService) {}

  @Get()
  mine(@CurrentUser() user: User): Promise<MyPowerUserDto> {
    return this.powerUsers.mine(user);
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ name: "power-user-claim", limit: 10, windowSeconds: 86_400, by: "user" })
  claim(@CurrentUser() user: User): Promise<MyPowerUserDto> {
    return this.powerUsers.claim(user);
  }
}

/** The public label (visitors included). */
@Controller("v1/users")
export class UserStatusController {
  constructor(private readonly powerUsers: PowerUserService) {}

  @Get(":userId/status")
  @Public()
  @RateLimit({ name: "user-status", limit: 120, windowSeconds: 60, by: "ip" })
  status(@Param("userId", IdParam) userId: string): Promise<UserStatusDto> {
    return this.powerUsers.publicStatus(userId);
  }
}
