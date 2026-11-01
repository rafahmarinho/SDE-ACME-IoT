import { z } from 'zod';
import { ApiError, createRoute, logActivityEvent } from '../_lib/security';
import { TenantStore } from '../_lib/store';
import { DEVICE_TYPES, PRINTABLE_TEXT } from '../_lib/tenantData';

// SDE T536, T42, T569, T34: strict request schema (strong types, bounded lengths, unknown fields rejected)
const EnrollDeviceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).regex(PRINTABLE_TEXT),
    code: z.string().trim().min(3).max(50).regex(/^[A-Za-z0-9_-]+$/),
    type: z.enum(DEVICE_TYPES),
    buildingId: z.string().uuid(),
    roomId: z.string().uuid(),
    // Optional; when present it must match the caller's organization from the verified token.
    organizationId: z.string().uuid().optional(),
  })
  .strict();

// SDE T2139: only these fields can leave the API.
const EnrolledDeviceResponseSchema = z
  .object({
    success: z.literal(true),
    device: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        code: z.string(),
        type: z.enum(DEVICE_TYPES),
        buildingId: z.string().uuid(),
        roomId: z.string().uuid(),
        organizationId: z.string().uuid(),
        status: z.literal('online'),
        createdAt: z.string(),
      })
      .strict(),
  })
  .strict();

const INITIAL_DESIRED_STATE: Record<(typeof DEVICE_TYPES)[number], Record<string, unknown>> = {
  thermostat: { target_temp: 22.0, mode: 'cooling' },
  smart_plug: { power: 'on' },
  temperature_sensor: {},
  humidity_sensor: {},
  occupancy_sensor: {},
};

type Row = Record<string, any>;

// POST /api/devices: device enrollment, restricted to roles with devices:admin.
export default createRoute({
  name: 'devices',
  cors: true,
  rateLimit: { max: 30, windowMs: 60000 },
  methods: {
    POST: {
      auth: 'required',
      permission: 'devices:admin',
      handler: async (ctx) => {
        const body = await ctx.readBody(EnrollDeviceSchema);
        const store = TenantStore.forCaller(ctx);
        const organizationId = store.organizationId;
        // SDE T18, T378: the tenant comes from the verified token, never from the request body.
        if (body.organizationId && body.organizationId !== organizationId) {
          throw new ApiError(403, 'Forbidden', 'organizationId does not match the caller organization');
        }
        // SDE T378: the referenced building must belong to the caller's organization and the room to that building.
        const building = await store.findOne<Row>('buildings', 'id', { id: body.buildingId, organization_id: organizationId });
        if (!building) throw new ApiError(404, 'Not found', 'building is not in the caller organization');
        const room = await store.findOne<Row>('rooms', 'id', { id: body.roomId, building_id: body.buildingId });
        if (!room) throw new ApiError(404, 'Not found', 'room is not in the selected building');

        const device = await store.insert<Row>(
          'devices',
          {
            organization_id: organizationId,
            building_id: body.buildingId,
            room_id: body.roomId,
            name: body.name,
            code: body.code.toUpperCase(),
            type: body.type,
            desired_state: INITIAL_DESIRED_STATE[body.type],
          },
          'id,name,code,type,building_id,room_id,organization_id,status,created_at'
        );
        logActivityEvent('device_enrolled', {
          route: 'devices',
          method: 'POST',
          userId: store.principal.userId,
          organizationId,
          objectType: 'device',
          objectId: device.id,
          changes: { code: device.code, type: device.type, buildingId: body.buildingId, roomId: body.roomId },
        });
        ctx.send(201, EnrolledDeviceResponseSchema, {
          success: true,
          device: {
            id: device.id,
            name: device.name,
            code: device.code,
            type: device.type,
            buildingId: device.building_id,
            roomId: device.room_id,
            organizationId: device.organization_id,
            status: device.status,
            createdAt: device.created_at,
          },
        });
      },
    },
  },
});
