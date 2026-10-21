import { hash, verify, argon2id } from 'argon2';

export function hashPassword(password) {
  return hash(password, {
    type: argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

export function verifyPassword(passwordHash, password) {
  return verify(passwordHash, password);
}
