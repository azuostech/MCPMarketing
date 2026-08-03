// Import the Express application statically so Vercel's Node builder includes
// the complete MCP runtime in the serverless function bundle.
import app from '../src/httpServer.js';

export default app;
