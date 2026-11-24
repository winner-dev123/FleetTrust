import type { ServerResponse } from "node:http";

import type { User } from "@fleettrust/db";
import {
  assignDriverSchema,
  completeScheduleSchema,
  createDocumentShareSchema,
  createServiceRecordSchema,
  createVehicleDocumentSchema,
  createVehicleSchema,
  odometerReadingSchema,
  scheduleSchema,
  updateVehicleDocumentSchema,
  updateVehicleSchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { VehicleDocumentsService } from "./documents.service.js";
import { HistoryService } from "./history.service.js";
import { VehiclesService } from "./vehicles.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

function sendFile(res: ServerResponse, file: { data: Buffer; contentType: string }): void {
  res.writeHead(200, {
    "Content-Type": file.contentType,
    "Content-Length": String(file.data.length),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "attachment",
  });
  res.end(file.data);
}

/** Your vehicles: personal ones, and fleet vehicles assigned to you. */
@Controller("v1/me/vehicles")
export class MyVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.vehicles.listMine(user);
  }

  @Post()
  @RateLimit({ name: "vehicle-create", limit: 30, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.vehicles.createPersonal(user, parseBody(createVehicleSchema, body));
  }
}

/** A fleet's vehicles (`vehicles.manage`; branch-scoped managers: their branch). */
@Controller("v1/orgs/:orgId/vehicles")
export class FleetVehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  @OrgPermission("vehicles.manage")
  list(@CurrentTenant() access: TenantAccess, @Query("archived") archived: unknown) {
    return this.vehicles.listFleet(access, archived === "true");
  }

  @Post()
  @OrgPermission("vehicles.manage")
  create(@CurrentTenant() access: TenantAccess, @CurrentUser() user: User, @Body() body: unknown) {
    return this.vehicles.createFleet(access, user, parseBody(createVehicleSchema, body));
  }
}

/** One vehicle. Access is checked per vehicle (owner, fleet manager in scope, assigned driver). */
@Controller("v1/vehicles/:vehicleId")
export class VehicleController {
  constructor(
    private readonly vehicles: VehiclesService,
    private readonly history: HistoryService,
    private readonly documents: VehicleDocumentsService,
  ) {}

  @Get()
  get(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.vehicles.get(user, id);
  }

  @Patch()
  update(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.vehicles.update(user, id, parseBody(updateVehicleSchema, body));
  }

  @Post("archive")
  @HttpCode(200)
  archive(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.vehicles.archive(user, id);
  }

  @Post("odometer")
  @HttpCode(200)
  odometer(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.vehicles.reportOdometer(
      user,
      id,
      parseBody(odometerReadingSchema, body).odometerKm,
    );
  }

  @Put("driver")
  assign(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.vehicles.assign(user, id, parseBody(assignDriverSchema, body).userId);
  }

  @Delete("driver")
  unassign(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.vehicles.unassign(user, id);
  }

  // --- Service history -------------------------------------------------------------------------

  @Get("service-records")
  records(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.history.history(user, id);
  }

  @Post("service-records")
  @RateLimit({ name: "service-record", limit: 120, windowSeconds: 3600, by: "user" })
  addRecord(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.history.addRecord(user, id, parseBody(createServiceRecordSchema, body));
  }

  @Delete("service-records/:recordId")
  @HttpCode(204)
  async deleteRecord(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("recordId", IdParam) recordId: string,
  ): Promise<void> {
    await this.history.deleteRecord(user, id, recordId);
  }

  // --- Maintenance -----------------------------------------------------------------------------

  @Get("schedules")
  schedules(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.history.schedules(user, id);
  }

  @Post("schedules")
  addSchedule(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.history.addSchedule(user, id, parseBody(scheduleSchema, body));
  }

  @Put("schedules/:scheduleId")
  updateSchedule(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("scheduleId", IdParam) scheduleId: string,
    @Body() body: unknown,
  ) {
    return this.history.updateSchedule(user, id, scheduleId, parseBody(scheduleSchema, body));
  }

  @Delete("schedules/:scheduleId")
  @HttpCode(204)
  async removeSchedule(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("scheduleId", IdParam) scheduleId: string,
  ): Promise<void> {
    await this.history.removeSchedule(user, id, scheduleId);
  }

  @Post("schedules/:scheduleId/complete")
  @HttpCode(200)
  complete(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("scheduleId", IdParam) scheduleId: string,
    @Body() body: unknown,
  ) {
    return this.history.completeSchedule(
      user,
      id,
      scheduleId,
      parseBody(completeScheduleSchema, body),
    );
  }

  // --- Documents -------------------------------------------------------------------------------

  @Get("documents")
  documentsList(@CurrentUser() user: User, @Param("vehicleId", IdParam) id: string) {
    return this.documents.list(user, id);
  }

  @Post("documents")
  @RateLimit({ name: "vehicle-document", limit: 60, windowSeconds: 3600, by: "user" })
  createDocument(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.documents.create(user, id, parseBody(createVehicleDocumentSchema, body));
  }

  @Post("documents/:documentId/complete")
  @HttpCode(200)
  completeDocument(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
  ) {
    return this.documents.complete(user, id, documentId);
  }

  @Patch("documents/:documentId")
  updateDocument(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.update(
      user,
      id,
      documentId,
      parseBody(updateVehicleDocumentSchema, body),
    );
  }

  @Delete("documents/:documentId")
  @HttpCode(204)
  async removeDocument(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
  ): Promise<void> {
    await this.documents.remove(user, id, documentId);
  }

  @Get("documents/:documentId/file")
  async download(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    sendFile(res, await this.documents.download(user, id, documentId));
  }

  @Post("documents/:documentId/shares")
  @RateLimit({ name: "document-share", limit: 30, windowSeconds: 86_400, by: "user" })
  share(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
    @Body() body: unknown,
  ) {
    return this.documents.createShare(
      user,
      id,
      documentId,
      parseBody(createDocumentShareSchema, body),
    );
  }

  @Get("documents/:documentId/shares")
  shares(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
  ) {
    return this.documents.shares(user, id, documentId);
  }

  @Delete("documents/:documentId/shares/:shareId")
  @HttpCode(204)
  async revoke(
    @CurrentUser() user: User,
    @Param("vehicleId", IdParam) id: string,
    @Param("documentId", IdParam) documentId: string,
    @Param("shareId", IdParam) shareId: string,
  ): Promise<void> {
    await this.documents.revokeShare(user, id, documentId, shareId);
  }
}

/** Opening a share link: no sign-in, limited by time and views, audited. */
@Controller("v1/shared-documents")
export class SharedDocumentsController {
  constructor(private readonly documents: VehicleDocumentsService) {}

  @Get(":token")
  @Public()
  @RateLimit({ name: "shared-document", limit: 30, windowSeconds: 60, by: "ip" })
  async open(@Param("token") token: string, @Res() res: ServerResponse): Promise<void> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    sendFile(res, await this.documents.openShare(token));
  }
}
