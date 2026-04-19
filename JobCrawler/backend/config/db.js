const mongoose = require('mongoose');
const dns = require('dns');

// Force IPv4 DNS resolution — many services (Workday, Greenhouse, Apify)
// reject IPv6 connections or return errors when resolved via IPv6
dns.setDefaultResultOrder('ipv4first');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) return;

  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
    isConnected = true;
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    throw err;
  }
};

module.exports = connectDB;
