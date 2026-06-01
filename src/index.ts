import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './configs/app.config';
import { securityHeaders } from './middlewares/security.middleware';
import { globalLimiter } from './middlewares/rate-limit.middleware';
import { loggerMiddleware } from './middlewares/logger.middleware';
import { errorHandler } from './middlewares/error.middleware';
import apiRoutes from './routes';

const app = express();

// Security middlewares
app.use(helmet());
app.use(securityHeaders);

const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map(o => o.trim());
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(globalLimiter);
app.use(loggerMiddleware);

// IMPORTANT: Webhook must use express.raw BEFORE express.json
import { webhookHandler } from './controllers/public_controllers/webhook.controller';
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);

// Standard JSON body parser for all other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes ff534
app.use('/api', apiRoutes);

// Global Error Handler
app.use(errorHandler);

app.listen(config.PORT, () => {
  console.log(`🚀 Server running in ${config.NODE_ENV} mode on port ${config.PORT}`);
});
