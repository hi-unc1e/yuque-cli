export const EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  ERROR: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  RATE_LIMIT: 5
});

export class CliError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'CliError';
    this.code = options.code || 'CLI_ERROR';
    this.exitCode = options.exitCode ?? EXIT_CODES.ERROR;
    this.status = options.status;
    this.payload = options.payload;
  }
}

export class UsageError extends CliError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || 'USAGE_ERROR',
      exitCode: EXIT_CODES.USAGE
    });
    this.name = 'UsageError';
  }
}

export class AuthError extends CliError {
  constructor(message = 'A Yuque API token is required', options = {}) {
    super(message, {
      ...options,
      code: options.code || 'AUTH_ERROR',
      exitCode: EXIT_CODES.AUTH
    });
    this.name = 'AuthError';
  }
}

export class NotFoundError extends CliError {
  constructor(message = 'The requested resource does not exist', options = {}) {
    super(message, {
      ...options,
      code: options.code || 'NOT_FOUND',
      exitCode: EXIT_CODES.NOT_FOUND
    });
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends CliError {
  constructor(message = 'Rate limited by the Yuque API', options = {}) {
    super(message, {
      ...options,
      code: options.code || 'RATE_LIMITED',
      exitCode: EXIT_CODES.RATE_LIMIT
    });
    this.name = 'RateLimitError';
  }
}

export function errorFromResponse(status, payload, fallbackMessage) {
  const message =
    payload?.message ||
    payload?.error_description ||
    payload?.error ||
    fallbackMessage ||
    `Yuque API request failed with status ${status}`;

  if (status === 401 || status === 403) {
    return new AuthError(message, { status, payload });
  }
  if (status === 404) {
    return new NotFoundError(message, { status, payload });
  }
  if (status === 429) {
    return new RateLimitError(message, { status, payload });
  }
  return new CliError(message, {
    code: `HTTP_${status}`,
    exitCode: EXIT_CODES.ERROR,
    status,
    payload
  });
}

export function errorEnvelope(error) {
  const err =
    error instanceof CliError
      ? error
      : new CliError(error?.message || String(error || 'Unknown error'));

  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      ...(err.status === undefined ? {} : { status: err.status })
    }
  };
}
