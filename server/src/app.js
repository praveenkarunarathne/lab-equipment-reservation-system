import express from 'express';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.get('/', (_req, res) => {
    res.json({ message: 'Lab Equipment Reservation API' });
  });
  return app;
}
