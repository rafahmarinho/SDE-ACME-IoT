import type { IncomingMessage, ServerResponse } from 'http';

const SCENARIOS = [
  { id: 'normal', name: 'Normal Operations', description: 'Balanced environmental conditions with minor noise' },
  { id: 'heatwave', name: 'High Heatwave & Load', description: 'Elevates temperature readings causing high cooling demand' },
  { id: 'network_jitter', name: 'Network Degraded / Flapping', description: 'Random packet drops, high RSSI attenuation, offline status' },
  { id: 'battery_drain', name: 'Battery Drain Emergency', description: 'Accelerates battery consumption to trigger low-battery warnings' },
  { id: 'firmware_wave', name: 'Firmware Rollout Wave', description: 'Simulates staged OTA delivery with progress and rollback options' },
];

export default function handler(req: IncomingMessage, res: ServerResponse) {
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

  if (req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, scenarios: SCENARIOS }));
    return;
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
