const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'info'];

const log = (level, message, data = {}) => {
  if (LOG_LEVELS[level] <= currentLevel) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...data };
    console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
  }
};

module.exports = {
  error: (msg, data) => log('error', msg, data),
  warn: (msg, data) => log('warn', msg, data),
  info: (msg, data) => log('info', msg, data),
  debug: (msg, data) => log('debug', msg, data),
};
