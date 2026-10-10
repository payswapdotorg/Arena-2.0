import {
  ARENA_ERROR_CATALOG,
  arenaErrorEnvelopeSchema,
  type ArenaErrorCode,
} from "@arena/contracts";
import { DomainError } from "@arena/application";

/**
 * 类型化错误映射：ArenaError 目录的 HTTP 状态 + 错误信封。
 * 未知异常一律 ARENA_INTERNAL_ERROR（不泄露内部细节）。
 */

export function errorResponseBody(
  error: unknown,
  correlationId: string,
  requestId: string | null,
): { status: number; body: unknown } {
  if (error instanceof DomainError) {
    const code = error.code as ArenaErrorCode;
    const catalog = ARENA_ERROR_CATALOG[code];
    const status = catalog !== undefined ? catalog.http_status : error.httpStatus;
    const envelope = arenaErrorEnvelopeSchema.safeParse({
      code,
      message: error.message,
      correlation_id: correlationId,
      request_id: requestId,
      details: error.details ?? null,
    });
    return {
      status,
      body: envelope.success
        ? envelope.data
        : {
            code,
            message: error.message,
            correlation_id: correlationId,
            request_id: requestId,
            details: null,
          },
    };
  }
  const envelope = arenaErrorEnvelopeSchema.safeParse({
    code: "ARENA_INTERNAL_ERROR",
    message: "unclassified server error",
    correlation_id: correlationId,
    request_id: requestId,
    details: null,
  });
  return { status: 500, body: envelope.success ? envelope.data : null };
}
