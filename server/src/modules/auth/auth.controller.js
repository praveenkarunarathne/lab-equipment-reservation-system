import { randomBytes } from 'node:crypto';
import {
  sessionCookieName,
  sessionCookieOptions,
} from '../../middleware/session.js';

export function createAuthController(service, env) {
  return {
    async register(req, res) {
      res
        .status(201)
        .json({ data: { user: await service.register(req.validated.body) } });
    },
    async login(req, res) {
      const user = await service.login(req.validated.body);
      await new Promise((resolve, reject) =>
        req.session.regenerate((error) => (error ? reject(error) : resolve())),
      );
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.csrfToken = randomBytes(32).toString('hex');
      await new Promise((resolve, reject) =>
        req.session.save((error) => (error ? reject(error) : resolve())),
      );
      res.json({ data: { user, csrfToken: req.session.csrfToken } });
    },
    async logout(req, res) {
      await new Promise((resolve, reject) =>
        req.session.destroy((error) => (error ? reject(error) : resolve())),
      );
      res.clearCookie(sessionCookieName(env), sessionCookieOptions(env));
      res.sendStatus(204);
    },
    async me(req, res) {
      res.json({ data: { user: await service.currentUser(req.actor.userId) } });
    },
  };
}
