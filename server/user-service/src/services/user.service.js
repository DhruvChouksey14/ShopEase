const { config } = require("../config");
const {redis} = require("../config/redis");
const prisma = require('../config/prisma');
const { ConflictError } = require('../utils/error');

const getProfile = async(userId) =>{
     console.log("First check user in Redis");

     const storedUser = await redis.get(`user:${userId}`);
     if(storedUser){
          console.log("Fetched user profile from redis");
          return JSON.parse(storedUser);
     }
     console.log("If user is not in redis, fetch user from DB");
     const userProfile = await prisma.user.findUnique({
          where: {
               id: userId
          }
     })
     if (!userProfile) return null;

     console.log("Exclude password field from the user");
     const {password: _password, ...safeUser} = userProfile;
     console.log("Store user profile in redis for future lookups");
     await redis.set(`user:${userId}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return safeUser;
}

const updateProfile = async (userId, data) => {
     let user;
     try {
          user = await prisma.user.update({
               where: { id: userId },
               data: {
                    ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
                    ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
                    ...(data.email !== undefined ? { email: data.email } : {}),
               },
          });
     } catch (error) {
          const target = error.meta?.target;
          if (error.code === 'P2002' && (target === 'email' || target?.includes?.('email'))) {
               throw new ConflictError('That email address is already in use', 'EMAIL_ALREADY_IN_USE');
          }
          throw error;
     }
     const { password: _password, ...safeUser } = user;
     await redis.set(`user:${userId}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return safeUser;
};

const revokeRefreshTokens = async (userId) => {
     let cursor = '0';
     do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `refresh:${userId}:*`, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length) await redis.del(...keys);
     } while (cursor !== '0');
};

const deleteProfile = async (userId) => {
     await prisma.user.delete({ where: { id: userId } });
     await redis.del(`user:${userId}`);
     await revokeRefreshTokens(userId);
};

module.exports = {getProfile, updateProfile, deleteProfile}