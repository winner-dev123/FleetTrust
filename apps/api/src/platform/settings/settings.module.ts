import { Global, Module } from "@nestjs/common";

import { SettingsService } from "./settings.service.js";

/** Admin feature and category settings, readable from any module (Prompt 26). */
@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
