import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { ReviewService } from "./review.service.js";
import {
  DocumentAccessController,
  MyVerificationController,
  OrgVerificationController,
  ReviewController,
  VerificationCaseController,
} from "./verification.controller.js";
import { VerificationService } from "./verification.service.js";

/**
 * Document verification (SRS F-020..F-023, ADR-0006, ADR-0016). Independent of plans and
 * entitlements by construction: eslint.boundaries.js forbids importing them (ADR-0009).
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    MyVerificationController,
    OrgVerificationController,
    VerificationCaseController,
    ReviewController,
    DocumentAccessController,
  ],
  providers: [VerificationService, ReviewService],
  exports: [VerificationService],
})
export class VerificationModule {}
