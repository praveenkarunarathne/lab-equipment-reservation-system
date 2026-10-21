import { randomBytes } from 'node:crypto';
import { getUserModel } from '../users/user.model.js';
import { userDto } from '../users/user.dto.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';
import { AppError } from '../../shared/AppError.js';

let dummyHash;

export function createAuthService(connection) {
  const User = getUserModel(connection);
  return {
    async register(input) {
      const user = await User.create({
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        role: 'student',
      });
      return { ...userDto(user), createdAt: user.createdAt.toISOString() };
    },
    async login({ email, password }) {
      dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
      const fallback = await dummyHash;
      const user = await User.findOne({ email }).select('+passwordHash');
      const valid = await verifyPassword(
        user?.passwordHash ?? fallback,
        password,
      );
      if (!user || !valid)
        throw new AppError(
          401,
          'INVALID_CREDENTIALS',
          'Invalid email or password.',
        );
      return userDto(user);
    },
    async currentUser(id) {
      const user = await User.findById(id);
      if (!user) throw new AppError(401, 'AUTH_REQUIRED', 'Please sign in.');
      return userDto(user);
    },
    async seedAdmin(input) {
      const existing = await User.findOne({ email: input.email });
      if (existing) return existingAdmin(existing);
      try {
        const user = await User.create({
          name: input.name,
          email: input.email,
          passwordHash: await hashPassword(input.password),
          role: 'admin',
        });
        return { created: true, user: userDto(user) };
      } catch (error) {
        if (error.code !== 11000) throw error;
        return existingAdmin(await User.findOne({ email: input.email }));
      }
    },
  };
}

function existingAdmin(user) {
  if (user?.role !== 'admin')
    throw new AppError(
      409,
      'FORBIDDEN',
      'Refusing to promote or overwrite an existing student.',
    );
  return { created: false, user: userDto(user) };
}
