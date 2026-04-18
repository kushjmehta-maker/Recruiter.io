const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  resumeText: { type: String, default: '' },
  resumeFileName: { type: String, default: '' },
  targetRoles: [{ type: String, trim: true }],
  targetLocations: [{ type: String, trim: true }],
  // Preferred locations for job filtering (e.g. ["India", "Bangalore", "Remote"])
  // Empty array = all locations (no filter)
  preferredLocations: [{ type: String, trim: true }],
  // Companies to receive alerts for (e.g. ["google", "stripe", "nvidia"])
  // Empty array = all companies (no filter)
  alertCompanies: [{ type: String, trim: true, lowercase: true }],
  alertThreshold: { type: Number, default: 75, min: 0, max: 100 },
  lastAlertSentAt: { type: Date, default: null },
}, { timestamps: true });

// email uniqueness is handled by `unique: true` in the schema definition above

module.exports = mongoose.model('User', userSchema);
