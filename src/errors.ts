/**
 * 统一错误模型。
 *
 * 设计约束：
 * - Widget 函数不能把异常抛给宿主（Rex 会把未捕获异常呈现为「模块出错」并可能中断后续请求），
 *   因此所有内部异常都收敛为 {@link HubError}，由入口函数捕获并降级为空结果。
 * - 错误码是稳定契约：日志、测试和用户提示都依赖它，不要随意改名。
 */
export type HubErrorCode =
  | "INVALID_CONFIG"
  | "UNSUPPORTED_SOURCE"
  | "MISSING_ENDPOINT"
  | "BLOCKED_PROTOCOL"
  | "BLOCKED_HOST"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "HTTP_FAILED"
  | "HTTP_STATUS"
  | "INVALID_PAYLOAD"
  | "NOT_FOUND";

export class HubError extends Error {
  readonly code: HubErrorCode;

  constructor(
    code: HubErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options as ErrorOptions | undefined);
    this.name = "HubError";
    this.code = code;
  }
}

/** 把任意未知异常规整为 HubError，便于统一处理。 */
export function asHubError(
  error: unknown,
  fallback: HubErrorCode = "HTTP_FAILED"
): HubError {
  if (error instanceof HubError) {
    return error;
  }
  if (error instanceof Error) {
    const timeoutish =
      error.name === "AbortError" || /timeout|timed out/i.test(error.message);
    return new HubError(timeoutish ? "TIMEOUT" : fallback, error.message, {
      cause: error,
    });
  }
  return new HubError(fallback, String(error));
}

/**
 * 记录一条降级日志。Rex 允许模块使用 console，且日志不会外发到网络。
 * 这里只输出错误码与简短原因，避免把凭据、URL 查询串等敏感上下文写进日志。
 */
export function report(scope: string, error: unknown): void {
  const hubError = asHubError(error);
  console.warn(
    `[rex-hub] ${scope} 降级 (${hubError.code}): ${hubError.message}`
  );
}
