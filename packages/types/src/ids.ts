import { z } from "zod";

/** All primary keys are UUIDs (see docs/adr/0003). */
export const uuidSchema = z.uuid();
export type Uuid = z.infer<typeof uuidSchema>;
