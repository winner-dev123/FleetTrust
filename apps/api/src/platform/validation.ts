import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** Parses a request body with a shared zod schema; 400 `validation_failed` with issue paths otherwise. */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      statusCode: 400,
      error: "validation_failed",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}
