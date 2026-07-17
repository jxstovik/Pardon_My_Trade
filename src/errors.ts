export type ErrorSource =
  | "config"
  | "fixture_adapter"
  | "sleeper_adapter"
  | "platform_adapter"
  | "knowledge"
  | "rule_engine"
  | "decision_engine"
  | "recommendation_engine"
  | "validation";

export class PmtError extends Error {
  readonly code: string;
  readonly source: ErrorSource;
  readonly retryable: boolean;
  readonly correlationId?: string;

  constructor(params: {
    code: string;
    message: string;
    source: ErrorSource;
    retryable?: boolean;
    correlationId?: string;
  }) {
    super(params.message);
    this.name = "PmtError";
    this.code = params.code;
    this.source = params.source;
    this.retryable = params.retryable ?? false;
    this.correlationId = params.correlationId;
  }
}

export function validationError(message: string): PmtError {
  return new PmtError({
    code: "VALIDATION_FAILED",
    message,
    source: "validation",
    retryable: false
  });
}
