const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const { parseResume } = require('../services/resume-parser');

const router = express.Router();

// Store uploads in memory (PDF → buffer → text, no disk needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// POST /api/upload/resume — Upload resume and register/update user
router.post('/resume', upload.single('resume'), async (req, res) => {
  try {
    const { email, targetRoles, targetLocations, preferredLocations, alertCompanies } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Resume PDF is required' });
    }

    // Parse roles
    let roles = [];
    try {
      roles = typeof targetRoles === 'string' ? JSON.parse(targetRoles) : targetRoles || [];
    } catch {
      roles = [targetRoles].filter(Boolean);
    }

    let locations = [];
    try {
      locations = typeof targetLocations === 'string' ? JSON.parse(targetLocations) : targetLocations || [];
    } catch {
      locations = [targetLocations].filter(Boolean);
    }

    let prefLocations = [];
    try {
      prefLocations = typeof preferredLocations === 'string' ? JSON.parse(preferredLocations) : preferredLocations || [];
    } catch {
      prefLocations = [preferredLocations].filter(Boolean);
    }

    let companies = [];
    try {
      companies = typeof alertCompanies === 'string' ? JSON.parse(alertCompanies) : alertCompanies || [];
    } catch {
      companies = [alertCompanies].filter(Boolean);
    }

    // Parse resume PDF
    const resumeText = await parseResume(req.file.buffer);

    // Upsert user
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      {
        resumeText,
        resumeFileName: req.file.originalname,
        targetRoles: roles,
        targetLocations: locations,
        preferredLocations: prefLocations,
        alertCompanies: companies,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({
      userId: user._id,
      email: user.email,
      targetRoles: user.targetRoles,
      targetLocations: user.targetLocations,
      preferredLocations: user.preferredLocations,
      alertCompanies: user.alertCompanies,
      resumeParsed: true,
      resumeSnippet: resumeText.slice(0, 200) + '...',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
