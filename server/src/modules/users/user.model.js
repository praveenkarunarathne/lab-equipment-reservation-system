import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
      required: true,
    },
  },
  { timestamps: true, autoIndex: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'uq_users_email' });

export function getUserModel(connection) {
  return connection.models.User ?? connection.model('User', userSchema);
}
