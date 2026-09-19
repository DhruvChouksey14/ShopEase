/**
 * Standard JSON error handler — mounted last in every service's index.js.
 * Formats AppError subclasses (utils/error.js) into a consistent envelope.
 */
function errorHandler(err, req, res, next) {
     const statusCode = err.statusCode || err.status || 500;
     const code = err.code || 'INTERNAL_ERROR';

     if (statusCode >= 500) {
          console.error(`[${req.method} ${req.path}] ${statusCode} ${err.message}`, { stack: err.stack });
     } else {
          console.warn(`[${req.method} ${req.path}] ${statusCode} ${err.message}`);
     }

     res.status(statusCode).json({
          success: false,
          message: err.message || 'Internal Server Error',
          code,
     });
}

module.exports = { errorHandler };
