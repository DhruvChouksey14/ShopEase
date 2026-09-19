require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { config } = require('./config');
const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const { disconnectProducer } = require('./config/kafka');
const { createMetrics } = require('../../../shared/middlewares/metrics');
const { errorHandler } = require('../../../shared/middlewares/errorHandler');

const app = express();
const { metricsMiddleware, metricsHandler } = createMetrics('user-service');

app.use(corsMiddleware);
app.use(metricsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRoutes);
app.use("/user", userRoutes);

app.get("/metrics", metricsHandler);

app.get("/health", (req, res) => {
     res.status(200).json({
          success: true,
          message: "User Service is healthy",
          timestamp: new Date().toISOString(),
     })
})

app.use(errorHandler);

const startServer = async () => {
     try {
          const server = app.listen(config.PORT, () => {
               console.log(
                    `${config.SERVICE_NAME} is running on http://localhost:${config.PORT}`
               );
          })
          // Graceful shutdown
          const shutdown = async () => {
               console.log('Shutting down gracefully...');

               server.close(async () => {
                    await disconnectProducer();
                    console.log('Server closed');
                    process.exit(0);
               });
          };

          process.on('SIGTERM', shutdown);
          process.on('SIGINT', shutdown);
     } catch (error) {
          console.error("Failed to Start Server", error);
          process.exit(1);
     }
}
startServer();
