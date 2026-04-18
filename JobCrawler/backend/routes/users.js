const express = require('express');
const User = require('../models/User');
const { clearCrawlFilterCache } = require('../utils/crawl-filter');

const router = express.Router();

// POST /api/users/register — Register with email + target roles (no resume)
router.post('/register', async (req, res) => {
  try {
    const { email, targetRoles, targetLocations, preferredLocations, alertCompanies, alertThreshold } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      {
        targetRoles: targetRoles || [],
        targetLocations: targetLocations || [],
        preferredLocations: preferredLocations || [],
        alertCompanies: alertCompanies || [],
        ...(alertThreshold != null && { alertThreshold }),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      userId: user._id,
      email: user.email,
      targetRoles: user.targetRoles,
      preferredLocations: user.preferredLocations,
      alertCompanies: user.alertCompanies,
      alertThreshold: user.alertThreshold,
      hasResume: !!user.resumeText,
    });

    // Clear crawl filter cache so next crawl picks up new preferences
    clearCrawlFilterCache();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id — Get user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      userId: user._id,
      email: user.email,
      targetRoles: user.targetRoles,
      targetLocations: user.targetLocations,
      preferredLocations: user.preferredLocations,
      alertCompanies: user.alertCompanies,
      alertThreshold: user.alertThreshold,
      hasResume: !!user.resumeText,
      resumeFileName: user.resumeFileName,
      createdAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id — Update preferences
router.put('/:id', async (req, res) => {
  try {
    const { targetRoles, targetLocations, preferredLocations, alertCompanies, alertThreshold } = req.body;
    const update = {};
    if (targetRoles) update.targetRoles = targetRoles;
    if (targetLocations) update.targetLocations = targetLocations;
    if (preferredLocations) update.preferredLocations = preferredLocations;
    if (alertCompanies) update.alertCompanies = alertCompanies;
    if (alertThreshold != null) update.alertThreshold = alertThreshold;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    clearCrawlFilterCache();
    res.json({ userId: user._id, email: user.email, ...update });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
