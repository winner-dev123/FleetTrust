import type { ServerResponse } from "node:http";

import type { User } from "@fleettrust/db";
import { type ConsentStateDto, recordConsentSchema } from "@fleettrust/types";
import { Body, Controller, Delete, Get, HttpCode, Post, Res } from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { AllowSuspended, CheckRevoked, CurrentUser, Irreversible } from "../identity/index.js";
import { PrivacyService } from "./privacy.service.js";

/**
 * Privacy rights for the signed-in person (Prompt 27). Suspended members can still export
 * and delete their data: privacy rights don't depend on standing.
 */
@Controller("v1/me")
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get("consents")
  @AllowSuspended()
  consents(@CurrentUser() user: User): Promise<ConsentStateDto[]> {
    return this.privacy.consents(user.id);
  }

  @Post("consents")
  @HttpCode(200)
  @AllowSuspended()
  @RateLimit({ name: "consents", limit: 60, windowSeconds: 3600, by: "user" })
  record(@CurrentUser() user: User, @Body() body: unknown): Promise<ConsentStateDto[]> {
    return this.privacy.recordConsent(user, parseBody(recordConsentSchema, body));
  }

  /** A JSON file with everything FleetTrust holds about the person. */
  @Get("export")
  @AllowSuspended()
  @CheckRevoked()
  @RateLimit({ name: "data-export", limit: 5, windowSeconds: 86_400, by: "user" })
  async export(@CurrentUser() user: User, @Res() response: ServerResponse): Promise<void> {
    const body = JSON.stringify(await this.privacy.export(user), null, 2);
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="fleettrust-data.json"',
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(body);
  }

  /** Erases the account: needs a sign-in from the last 10 minutes and an explicit confirmation. */
  @Delete()
  @HttpCode(204)
  @AllowSuspended()
  @Irreversible("account.delete")
  @RateLimit({ name: "account-delete", limit: 5, windowSeconds: 3600, by: "user" })
  async delete(@CurrentUser() user: User): Promise<void> {
    await this.privacy.deleteAccount(user);
  }
}
