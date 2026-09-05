export const APP_ERROR_CODES = {
  UPDATE_CHECK_NETWORK: 'UPD-CHECK-001',
  UPDATE_CHECK_SERVICE: 'UPD-CHECK-002',
  UPDATE_FETCH_NETWORK: 'UPD-FETCH-001',
  UPDATE_FETCH_ASSET: 'UPD-FETCH-002',
  UPDATE_SIGNATURE: 'UPD-SIGN-001',
  UPDATE_RELOAD: 'UPD-RELOAD-001',
  UPDATE_PACKAGE_METADATA: 'UPD-PKG-001',
  UPDATE_PACKAGE_DOWNLOAD: 'UPD-PKG-002',
  UPDATE_PACKAGE_INTEGRITY: 'UPD-PKG-003',
  UPDATE_INSTALL_PERMISSION: 'UPD-INSTALL-001',
  UPDATE_UNKNOWN: 'UPD-UNKNOWN-999',
} as const;

export type AppErrorCode = typeof APP_ERROR_CODES[keyof typeof APP_ERROR_CODES];

export class PublicAppError extends Error {
  readonly publicCode: AppErrorCode;
  readonly cause?: unknown;

  constructor(publicCode: AppErrorCode, cause?: unknown) {
    super(publicCode);
    this.name = 'PublicAppError';
    this.publicCode = publicCode;
    this.cause = cause;
  }
}

export function publicErrorCode(error: unknown, fallback: AppErrorCode = APP_ERROR_CODES.UPDATE_UNKNOWN): AppErrorCode {
  return error instanceof PublicAppError ? error.publicCode : fallback;
}

export function publicErrorMessage(error: unknown, fallback: AppErrorCode = APP_ERROR_CODES.UPDATE_UNKNOWN) {
  return `操作未能完成，请稍后重试。\n错误代码：${publicErrorCode(error, fallback)}`;
}
