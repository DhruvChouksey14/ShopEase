const crypto = require('crypto');
const otpGenerator = require('otp-generator');
const { ConflictError, BadRequestError, ForbiddenError, UnauthorizedError, TooManyRequestsError } = require("../utils/error")
const notificationProducer = require('../kafka/producer/notification.producer')
const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const {redis} = require('../config/redis');
const { config } = require("../config");
const jwt = require('jsonwebtoken');
const {OAuth2Client} = require("google-auth-library");
const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

const RATE_MAX = parseInt(config.OTP_RATE_MAX_PER_HOUR || '5', 10);
const ATTEMPT_MAX = parseInt(config.OTP_MAX_VERIFY_ATTEMPTS || '5', 10);
const OTP_TTL = parseInt(config.OTP_TTL || '300', 10);
const HMAC_SECRET = config.OTP_HMAC_SECRET;

const hmacFor = (email, otp) => {
     return crypto.createHmac('sha256', HMAC_SECRET).update(email + ":" + otp).digest('hex');
};

const generateAndStoreOtp = async(meta) => {
     const rateKey = `otp:rate:${meta.email}`;
     const sentCount = parseInt(await redis.get(rateKey) || '0', 10);
     if(sentCount >= RATE_MAX){
          throw new TooManyRequestsError(
               "Too many OTP requests. Try again later.",
               "OTP_RATE_LIMIT"
          )
     }

     const otp = otpGenerator.generate(6, {
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false
     })

     const otpSessionId = crypto.randomUUID();
     const hashed = hmacFor(meta.email, otp);
     await redis.set(`otp:session:${otpSessionId}`, JSON.stringify({
          hashedOtp: hashed,
          meta
     }), 'EX', OTP_TTL);
     await redis.incr(rateKey);
     await redis.expire(rateKey, 3600);
     return {otp, otpSessionId};
};

const verifyOtp = async(otp, otpSessionId) => {
     const rawData = await redis.get(`otp:session:${otpSessionId}`);
     if(!rawData) return null;

     const {hashedOtp: storedOtp, meta} = JSON.parse(rawData);
     const attemptsKey = `otp:attempts:${meta.email}`;
     const attemptsCount = parseInt(await redis.get(attemptsKey) || '0', 10);
     if(attemptsCount >= ATTEMPT_MAX){
          throw new TooManyRequestsError("Too many attempts to verify OTP");
     }
     const hashedOtp = hmacFor(meta.email, otp);
     if(crypto.timingSafeEqual(
          Buffer.from(hashedOtp, 'hex'),
          Buffer.from(storedOtp, 'hex'))){
               await redis.del(`otp:session:${otpSessionId}`, attemptsKey);
               await redis.del(`otp:rate:${meta.email}`);
               return meta;
     }else{
          await redis.incr(attemptsKey);
          await redis.expire(attemptsKey, OTP_TTL);
          return null;
     }
};

const generateAccessToken = (userId, role) => {
     const payload = { id: userId, role };
     return jwt.sign(payload, config.JWT_ACCESS_SECRET, { expiresIn: config.ACCESS_TOKEN_EXP })
};

const generateRefreshToken = (userId, role) => {
     const payload = {
          id: userId,
          role,
          jti: crypto.randomUUID()
     };
     return jwt.sign(payload, config.JWT_REFRESH_SECRET, { expiresIn: config.REFRESH_TOKEN_EXP })
};

const verifyRefreshToken = (refreshToken) => {
     return jwt.verify(refreshToken, config.JWT_REFRESH_SECRET);
};

const sendOTP = async(firstName, lastName, email, password) =>{
     const existingUser = await prisma.user.findUnique({
          where: {email}
     })

     if(existingUser){
          throw new ConflictError("user already exists");
     }
     const hashedPassword = await bcrypt.hash(password, 12);
     const meta = {firstName, lastName, email, hashedPassword};
     const {otp, otpSessionId} = await generateAndStoreOtp(meta);
     await notificationProducer.sendOtpEmail(email, otp, (config.OTP_TTL) / 60);
     console.log(`OTP email queued for : ${email}`);
     return {otpSessionId}
}

const verifyOTP = async(otp, otpSessionId) =>{
     const meta = await verifyOtp(otp, otpSessionId);
     if(meta === null){
          throw new BadRequestError("Invalid or expired OTP", "OTP_INVALID");
     }
     const user = await prisma.user.create({
          data: {
               firstName: meta.firstName,
               lastName: meta.lastName,
               email: meta.email,
               password: meta.hashedPassword,
               emailVerified: true
          }
     })

     await notificationProducer.sendWelcomeEmail(meta.email, meta.firstName);
     console.log(`Welcome email queued for ${meta.email}`);
     return user;
     
}

const login = async(email, password, deviceId) =>{
     const existingUser = await prisma.user.findUnique({
          where: {email}
     })
     if(!existingUser){
          throw new UnauthorizedError("Invalid email or password", "INVALID_CREDENTIALS");
     }
     if(!existingUser.password){
          throw new BadRequestError(
               "This account was created with Google. Please sign in with Google.",
               "OAUTH_ONLY_ACCOUNT"
          );
     }
     const doesPasswordMatch = await bcrypt.compare(password, existingUser.password);
     if(!doesPasswordMatch){
          throw new UnauthorizedError("Invalid email or password", "INVALID_CREDENTIALS");
     }
     const accessToken = generateAccessToken(existingUser.id, existingUser.role);
     const refreshToken = generateRefreshToken(existingUser.id, existingUser.role);
     const {jti} = jwt.decode(refreshToken);
     await redis.set(`refresh:${existingUser.id}:${deviceId}`, jti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     const {password: _password, ...safeUser} = existingUser;
     await redis.set(`user:${existingUser.id}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return {accessToken, refreshToken, loggedInUser: safeUser};
}


const rotateRefreshToken = async(refreshToken, deviceId) =>{
     const payload = verifyRefreshToken(refreshToken);
     const {id: userId, jti} = payload;
     const storedJti = await redis.get(`refresh:${userId}:${deviceId}`);
     if(!storedJti){
          throw new ForbiddenError("Session Expired", "Login AGAIN")
     }
     if(storedJti !== jti){
          await redis.del(`refresh:${userId}:${deviceId}`);
          throw new ForbiddenError("Refresh token reused", "LOGIN AGAIN")
     }
     const role = payload.role || 'USER';
     const newAccessToken = generateAccessToken(payload.id, role);
     const newRefreshToken = generateRefreshToken(payload.id, role);
     const {jti: newJti} = jwt.decode(newRefreshToken);
     await redis.set(`refresh:${payload.id}:${deviceId}`, newJti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     return {newAccessToken, newRefreshToken};
}

const verifyGoogleIdToken = async(idToken, deviceId) =>{
     const ticket = await client.verifyIdToken({
          idToken,
          audience: config.GOOGLE_CLIENT_ID
     })
     const payload = ticket.getPayload();

     if(!payload.sub || !payload.email){
          throw new UnauthorizedError("Invalid Google Token Payload")
     }

     const googleUser = {
          provider: "google",
          providerId: payload.sub,
          email: payload.email,
          firstName: payload.given_name,
          lastName: payload.family_name,
          emailVerified: payload.email_verified || false
     }


     const user = await prisma.$transaction(async (tx) =>{
          let googleAuth = await tx.authProvider.findUnique({
               where: {
                    provider_providerId: {
                         provider: googleUser.provider,
                         providerId: googleUser.providerId
                    }
               },
               include: {user: true}
          })

          if(googleAuth){
               return googleAuth.user;
          }

          let existingUser = await tx.user.findUnique({
               where: {email: googleUser.email}
          })

          if(existingUser){
               await tx.authProvider.create({
                    data: {
                         provider: googleUser.provider,
                         providerId: googleUser.providerId,
                         userId: existingUser.id
                    }
               })
               return existingUser;
          }

          return await tx.user.create({
               data: {
                    email: googleUser.email,
                    firstName: googleUser.firstName,
                    lastName: googleUser.lastName,
                    emailVerified: googleUser.emailVerified,
                    AuthProviders: {
                         create: {
                              provider: googleUser.provider,
                              providerId: googleUser.providerId
                         }
                    }
               }
          })
     })

     const accessToken = generateAccessToken(user.id, user.role);
     const refreshToken = generateRefreshToken(user.id, user.role);
     const {jti} = jwt.decode(refreshToken);
     await redis.set(`refresh:${user.id}:${deviceId}`, jti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     const {password: _password, ...safeUser} = user;
     await redis.set(`user:${user.id}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return {accessToken, refreshToken, loggedInUser: safeUser};
     
}
module.exports = {sendOTP, verifyOTP, login, rotateRefreshToken, verifyGoogleIdToken}
