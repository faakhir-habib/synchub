import { Catch, HttpException, HttpStatus } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";

interface ErrorBody {
  error: string;
  code: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      response.status(status).json(this.shapeHttpException(exception, status));
      return;
    }

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: "internal", code: "internal_error" } satisfies ErrorBody);
  }

  private shapeHttpException(exception: HttpException, status: number): ErrorBody {
    const body = exception.getResponse();

    if (typeof body === "string") {
      return { error: body, code: `http_${status}` };
    }

    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      const code = typeof record.code === "string" ? record.code : `http_${status}`;
      let message: unknown = record.message ?? record.error;
      if (Array.isArray(message)) message = message[0];
      const error = typeof message === "string" ? message : exception.message;
      return { error, code };
    }

    return { error: exception.message, code: `http_${status}` };
  }
}
