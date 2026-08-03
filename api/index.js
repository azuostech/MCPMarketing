import app from '../dist/httpServer.js';

export default function handler(req, res) {
  return app(req, res);
}
