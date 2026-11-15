export class PmtError extends Error {
    code;
    source;
    retryable;
    correlationId;
    constructor(params) {
        super(params.message);
        this.name = "PmtError";
        this.code = params.code;
        this.source = params.source;
        this.retryable = params.retryable ?? false;
        this.correlationId = params.correlationId;
    }
}
export function validationError(message) {
    return new PmtError({
        code: "VALIDATION_FAILED",
        message,
        source: "validation",
        retryable: false
    });
}
