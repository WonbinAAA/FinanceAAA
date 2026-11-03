export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(value, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}

export function errorResponse(error) {
  // Never return provider messages, SQL, stack traces, tokens or ledger payloads.
  return json({ ok: false, error: error instanceof AppError ? error.message : 'ระบบขัดข้อง กรุณาลองใหม่',
    code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' },
  error instanceof AppError ? error.status : 500);
}
