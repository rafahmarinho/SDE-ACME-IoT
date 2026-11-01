import { z } from 'zod';
import { createRoute } from '../_lib/security';

const SCENARIOS = [
  { id: 'normal', name: 'Normal Operations', description: 'Balanced environmental conditions with minor noise' },
  { id: 'heatwave', name: 'High Heatwave & Load', description: 'Elevates temperature readings causing high cooling demand' },
  { id: 'network_jitter', name: 'Network Degraded / Flapping', description: 'Random packet drops, high RSSI attenuation, offline status' },
  { id: 'battery_drain', name: 'Battery Drain Emergency', description: 'Accelerates battery consumption to trigger low-battery warnings' },
  { id: 'firmware_wave', name: 'Firmware Rollout Wave', description: 'Simulates staged OTA delivery with progress and rollback options' },
];

const ScenariosResponseSchema = z
  .object({
    success: z.literal(true),
    scenarios: z.array(
      z.object({ id: z.string(), name: z.string(), description: z.string() }).strict()
    ),
  })
  .strict();

// GET /api/simulation/scenarios: authenticated members with devices:read.
export default createRoute({
  name: 'simulation-scenarios',
  cors: true,
  methods: {
    GET: {
      auth: 'required',
      permission: 'devices:read',
      handler: ({ send }) => send(200, ScenariosResponseSchema, { success: true, scenarios: SCENARIOS }),
    },
  },
});
