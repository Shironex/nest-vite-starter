export interface ErrorResponse {
  error: {
    message: string;
    code: number;
    data?: {
      code: string;
      errors?: Array<{
        field: string;
        message: string;
      }>;
    };
    stack?: string;
    path?: string;
  };
}

export interface HealthCheckResponse {
  status: string;
  uptime: number;
  checks: {
    database: {
      status: string;
      latency?: number;
    };
    redis: {
      status: string;
      latency?: number;
    };
    memory: {
      heapUsed: number;
      status: string;
    };
  };
}
