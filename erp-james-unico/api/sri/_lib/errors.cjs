class SriError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = options.code || "SRI_ERROR";
    this.httpStatus = Number(options.httpStatus || 400);
    this.details = options.details || null;
    this.retryable = Boolean(options.retryable);
  }
}

class SriConfigurationError extends SriError {
  constructor(message, details = null) {
    super(message, { code: "SRI_CONFIGURATION_ERROR", httpStatus: 503, details });
  }
}

class SriValidationError extends SriError {
  constructor(message, details = null) {
    super(message, { code: "SRI_VALIDATION_ERROR", httpStatus: 422, details });
  }
}

class SriTransportError extends SriError {
  constructor(message, options = {}) {
    super(message, {
      code: options.code || "SRI_TRANSPORT_ERROR",
      httpStatus: options.httpStatus || 502,
      details: options.details || null,
      retryable: options.retryable !== false
    });
  }
}

class SriBackendError extends SriError {
  constructor(message, details = null) {
    super(message, {
      code: "SRI_BACKEND_ERROR",
      httpStatus: 500,
      details,
      retryable: false
    });
  }
}

module.exports = {
  SriError,
  SriConfigurationError,
  SriValidationError,
  SriTransportError,
  SriBackendError
};
