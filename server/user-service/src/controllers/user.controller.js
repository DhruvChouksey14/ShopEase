const { BadRequestError, NotFoundError } = require("../utils/error");
const userService = require('../services/user.service');

const normalizeName = (value, field) => {
     if (typeof value !== 'string') {
          throw new BadRequestError(`${field} must be a string`);
     }
     const normalized = value.trim();
     if (!normalized || normalized.length > 100) {
          throw new BadRequestError(`${field} must contain 1 to 100 characters`);
     }
     return normalized;
};

const normalizeEmail = (value) => {
     if (typeof value !== 'string' || value.trim().length > 254) {
          throw new BadRequestError('email must be a valid email address');
     }
     const email = value.trim().toLowerCase();
     if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new BadRequestError('email must be a valid email address');
     }
     return email;
};

exports.getProfile = async (req, res) =>{
     const userId = req.user.id;
     if(!userId){
          throw new BadRequestError("User Id is missing");
     }

     const user = await userService.getProfile(userId);
     if (!user) {
          throw new NotFoundError("User not found");
     }
     return res.status(200).json({
          success: true,
          message: "Fetched user details",
          data: {
               user
          }
     })
};

exports.updateProfile = async (req, res) =>{
     const userId = req.user?.id;
     if (!userId) throw new BadRequestError("User Id is missing");
     const allowedFields = ['firstName', 'lastName', 'email'];
     const unknownFields = Object.keys(req.body || {}).filter((field) => !allowedFields.includes(field));
     if (unknownFields.length) {
          throw new BadRequestError(`Unsupported profile fields: ${unknownFields.join(', ')}`);
     }
     if (!Object.keys(req.body || {}).length) {
          throw new BadRequestError('At least one profile field is required');
     }

     const data = {};
     if (req.body.firstName !== undefined) data.firstName = normalizeName(req.body.firstName, 'firstName');
     if (req.body.lastName !== undefined) data.lastName = normalizeName(req.body.lastName, 'lastName');
     if (req.body.email !== undefined) data.email = normalizeEmail(req.body.email);

     const user = await userService.updateProfile(userId, data);
     return res.status(200).json({ success: true, message: 'Profile updated', data: { user } });
};

exports.deleteProfile = async (req, res) =>{
     const userId = req.user?.id;
     if (!userId) throw new BadRequestError("User Id is missing");
     await userService.deleteProfile(userId);
     return res.status(200).json({ success: true, message: 'Profile deleted' });
};

exports.getUserInternal = async (req, res) =>{
     const { userId } = req.params;
     if(!userId){
          throw new BadRequestError("User Id is missing");
     }

     const user = await userService.getProfile(userId);
     if(!user){
          throw new NotFoundError("User not found");
     }

     return res.status(200).json({
          success: true,
          data: {
               id: user.id,
               firstName: user.firstName,
               lastName: user.lastName,
               email: user.email,
          }
     });
};
