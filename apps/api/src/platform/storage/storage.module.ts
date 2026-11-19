import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  BadRequestException,
  Controller,
  type DynamicModule,
  ForbiddenException,
  GoneException,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Put,
  Req,
} from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";

import type { ApiEnv } from "../../config/env.js";
import { Public } from "../../modules/identity/index.js";
import { KEY_WRAPPER, KmsKeyWrapper, LocalKeyWrapper } from "../crypto/envelope.js";
import { ClamAvScanner, EicarOnlyScanner, MALWARE_SCANNER } from "../scanning/malware-scanner.js";
import { GcsObjectStorage } from "./gcs-storage.js";
import { MemoryObjectStorage } from "./memory-storage.js";
import { OBJECT_STORAGE, type ObjectStorage } from "./object-storage.js";

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new PayloadTooLargeException();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Local stand-in for a V4 signed upload URL (STORAGE_DRIVER=memory only; never registered
 * when deployed). The token in the path is the capability, like a signature.
 */
@Controller("v1/local-storage")
class LocalStorageController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Put(":token")
  @Public()
  @HttpCode(200)
  async upload(@Param("token") token: string, @Req() request: IncomingMessage): Promise<void> {
    if (!(this.storage instanceof MemoryObjectStorage)) throw new NotFoundException();
    const data = await readBody(request, 11 * 1024 * 1024);
    const error = this.storage.acceptUpload(token, request.headers["content-type"], data);
    if (error === "not_found") throw new NotFoundException();
    if (error === "expired") throw new GoneException();
    if (error === "content_type") throw new ForbiddenException();
    if (error === "too_large") throw new BadRequestException();
  }
}

/** Object storage, document encryption and malware scanning, chosen by configuration. */
@Module({})
export class StorageModule {
  static forRoot(env: ApiEnv): DynamicModule {
    const memory = env.STORAGE_DRIVER === "memory";
    return {
      module: StorageModule,
      global: true,
      controllers: memory ? [LocalStorageController] : [],
      providers: [
        {
          provide: OBJECT_STORAGE,
          useFactory: (): ObjectStorage =>
            memory
              ? new MemoryObjectStorage(env.PUBLIC_API_URL)
              : new GcsObjectStorage({
                  quarantine: env.STORAGE_QUARANTINE_BUCKET ?? "",
                  sensitive: env.STORAGE_SENSITIVE_BUCKET ?? "",
                }),
        },
        {
          provide: KEY_WRAPPER,
          useFactory: () =>
            env.DOCUMENT_KEY_PROVIDER === "kms"
              ? new KmsKeyWrapper(
                  env.DOCUMENT_KMS_KEY ?? "",
                  new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloudkms"] }),
                )
              : new LocalKeyWrapper(
                  env.DOCUMENT_LOCAL_KEK === undefined
                    ? randomBytes(32)
                    : Buffer.from(env.DOCUMENT_LOCAL_KEK, "base64"),
                ),
        },
        {
          provide: MALWARE_SCANNER,
          useFactory: () =>
            env.MALWARE_SCANNER === "clamav"
              ? new ClamAvScanner(env.CLAMAV_HOST ?? "", env.CLAMAV_PORT)
              : new EicarOnlyScanner(),
        },
      ],
      exports: [OBJECT_STORAGE, KEY_WRAPPER, MALWARE_SCANNER],
    };
  }
}
