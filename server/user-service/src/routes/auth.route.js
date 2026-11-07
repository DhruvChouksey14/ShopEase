const express = require('express');
const router = express.Router();
const {sendOTP, verifyOTP, login, rotateRefreshToken, verifyGoogleIdToken, logout} = require('../controllers/auth.controller');
const { getUserContext } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

router.post("/send-otp", sendOTP);
router.post("/verify-otp", verifyOTP);
router.post("/login", login);
router.post("/refresh", rotateRefreshToken);
router.post("/google-auth", verifyGoogleIdToken);
router.post("/logout", internalAuth, getUserContext, logout);
module.exports = router;