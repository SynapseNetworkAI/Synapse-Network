export class AdminApiError extends Error {
  status: number;
  code: string | null;
  requestId: string | null;
  data: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | null;
      requestId?: string | null;
      data?: unknown;
    }
  ) {
    super(message);
    this.name = "AdminApiError";
    this.status = options.status;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.data = options.data;
  }
}

export function isAdminApiError(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError;
}

export function isExpiredAdminSession(
  status: number,
  code: string | null,
  message: string
): boolean {
  return (
    status === 401 &&
    code === "UNAUTHORIZED" &&
    message.trim().toLowerCase() === "admin session expired"
  );
}
