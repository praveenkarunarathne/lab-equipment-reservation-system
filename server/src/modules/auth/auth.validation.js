import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
export const registrationSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  email,
  password: z.string().refine((value) => {
    const length = [...value].length;
    return length >= 15 && length <= 128;
  }, 'Password must contain 15 to 128 Unicode characters.'),
});

export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1).max(256),
});
