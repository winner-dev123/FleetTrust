import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import {
  EmployerApplicationsController,
  EmployerJobsController,
  MyApplicationsController,
  PublicJobsController,
} from "./jobs.controller.js";
import { JobsService } from "./jobs.service.js";

/** Job board (SRS F-153, F-154, ADR-0029): listings, applications, employer verification. */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    EmployerJobsController,
    EmployerApplicationsController,
    PublicJobsController,
    MyApplicationsController,
  ],
  providers: [JobsService],
})
export class JobsModule {}
