import type { IncomingMessage, ServerResponse } from 'http';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // SDE T35, T257: Security headers & CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      status: 'healthy',
      platform: 'ACME IoT Cloud API',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: 'PostgreSQL (Supabase)',
      simulationEngine: 'active',
    })
  );
}
