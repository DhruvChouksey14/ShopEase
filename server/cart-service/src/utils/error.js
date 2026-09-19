class AppError extends Error {
     constructor(message, statusCode, code) {
          super(message);
          this.statusCode = statusCode;
          this.code = code;
          Error.captureStackTrace(this, this.constructor);
     }
}
class BadRequestError extends AppError { constructor(message = 'Bad request', code = 'BAD_REQUEST') { super(message, 400, code); } }
class UnauthorizedError extends AppError { constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') { super(message, 401, code); } }
class ForbiddenError extends AppError { constructor(message = 'Forbidden', code = 'FORBIDDEN') { super(message, 403, code); } }
class NotFoundError extends AppError { constructor(message = 'Not found', code = 'NOT_FOUND') { super(message, 404, code); } }
class ConflictError extends AppError { constructor(message = 'Conflict', code = 'CONFLICT') { super(message, 409, code); } }

module.exports = { AppError, BadRequestError, UnauthorizedError, ForbiddenError, NotFoundError, ConflictError };
