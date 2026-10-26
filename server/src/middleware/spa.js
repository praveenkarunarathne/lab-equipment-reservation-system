import express from 'express';
import { accessSync, constants } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notFound } from './notFound.js';

export const defaultClientDist = fileURLToPath(
  new URL('../../../client/dist/', import.meta.url),
);

export function mountSpa(app, clientDist) {
  const index = join(clientDist, 'index.html');
  accessSync(index, constants.R_OK);
  app.use(
    '/assets',
    express.static(join(clientDist, 'assets'), {
      immutable: true,
      maxAge: '1y',
      index: false,
      redirect: false,
    }),
  );
  app.use('/assets', notFound);
  app.use(
    express.static(clientDist, {
      index: false,
      redirect: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((req, res, next) => {
    if (
      !['GET', 'HEAD'].includes(req.method) ||
      !req.accepts('html') ||
      extname(req.path) ||
      req.path.split('/').some((segment) => segment.startsWith('.'))
    )
      return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}
