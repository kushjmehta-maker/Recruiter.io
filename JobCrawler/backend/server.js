require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/db');
const { apiKeyAuth } = require('./middleware/auth');
const { sanitizeInput } = require('./middleware/sanitize');
const logger = require('./utils/logger');

const app = express();

// Security headers
app.use(helmet());

// CORS — lock to extension origin in production
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.EXTENSION_CORS_ORIGIN
    : '*',
}));

// Rate limiting — 100 requests per 15 minutes per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use(morgan('dev'));

// Sanitize inputs (NoSQL injection prevention)
app.use(sanitizeInput);

// API key authentication (skips /api/health)
app.use(apiKeyAuth);

// Routes
app.use('/api/users', require('./routes/users'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/crawl', require('./routes/crawl'));
app.use('/api/upload', require('./routes/upload'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

const start = async () => {
  await connectDB();
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });

  // Start scheduler if not in test mode
  if (process.env.NODE_ENV !== 'test') {
    const { startScheduler } = require('./services/scheduler');
    startScheduler();
  }
};

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
