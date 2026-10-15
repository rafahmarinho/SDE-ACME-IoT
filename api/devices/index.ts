import type { IncomingMessage, ServerResponse } from 'http';
import { z } from 'zod';

// SDE T536, T42: Request validation schema
const EnrollDeviceSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(3).max(50),
  type: z.enum(['thermostat', 'smart_plug', 'temperature_sensor', 'humidity_sensor', 'occupancy_sensor']),
  buildingId: z.string(),
  roomId: z.string(),
  organizationId: z.string(),
});

function parseBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // SDE T536: Restrict size of incoming messages (max 50KB)
      if (body.length > 50 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  // GET: Return simulated device list
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        count: 20,
        message: 'Use client-side Supabase client or local storage for direct realtime access.',
      })
    );
    return;
  }

  // POST: Validate enrollment payload
  if (req.method === 'POST') {
    try {
      const raw = await parseBody(req);
      const parsed = EnrollDeviceSchema.safeParse(raw);
      if (!parsed.success) {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: 'Validation failed',
            details: parsed.error.issues,
          })
        );
        return;
      }

      res.statusCode = 201;
      res.end(
        JSON.stringify({
          success: true,
          message: 'Device enrolled successfully',
          device: {
            ...parsed.data,
            id: 'd_api_' + Date.now(),
            status: 'online',
            createdAt: new Date().toISOString(),
          },
        })
      );
    } catch (err: any) {
      res.statusCode = err.message === 'Payload too large' ? 413 : 400;
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
