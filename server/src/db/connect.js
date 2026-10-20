import mongoose from 'mongoose';

export async function connectDatabase(uri) {
  await mongoose.connect(uri, {
    autoIndex: false,
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
