const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Job' }],
  sentAt: { type: Date, default: Date.now },
  emailStatus: { type: String, enum: ['sent', 'failed'], default: 'sent' },
  sendgridMessageId: { type: String, default: '' },
});

alertSchema.index({ userId: 1, sentAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
