import { z } from 'zod';
import { createRoute } from './_lib/security';

// SDE T373, T2139, T1873: the only unauthenticated API route. It reports liveness only
// (no product name, version or database vendor) and accepts GET exclusively.
const HealthResponseSchema = z
  .object({
    status: z.literal('ok'),
    timestamp: z.string(),
  })
  .strict();

export default createRoute({
  name: 'health',
  rateLimit: { max: 60, windowMs: 60000 },
  methods: {
    GET: {
      auth: 'public',
      handler: ({ send }) => send(200, HealthResponseSchema, { status: 'ok', timestamp: new Date().toISOString() }),
    },
  },
});
