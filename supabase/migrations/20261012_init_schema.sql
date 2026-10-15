-- ACME IoT Supabase PostgreSQL Schema & Security Policies (RLS)
-- Enables UUID generation and extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Organizations
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    plan VARCHAR(50) DEFAULT 'enterprise',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. User Profiles (extending auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'administrator', 'operator', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Buildings
CREATE TABLE IF NOT EXISTS public.buildings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) NOT NULL,
    address TEXT NOT NULL,
    total_floors INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Rooms
CREATE TABLE IF NOT EXISTS public.rooms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    floor INT NOT NULL DEFAULT 1,
    room_number VARCHAR(50) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('office', 'server_room', 'conference', 'lab', 'warehouse', 'cold_storage')),
    dimensions JSONB NOT NULL DEFAULT '{"width": 8, "length": 10, "height": 3}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Devices
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('thermostat', 'smart_plug', 'temperature_sensor', 'humidity_sensor', 'occupancy_sensor')),
    status VARCHAR(50) NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'warning', 'updating')),
    battery_level INT NOT NULL DEFAULT 100 CHECK (battery_level >= 0 AND battery_level <= 100),
    rssi INT NOT NULL DEFAULT -65,
    firmware_version VARCHAR(50) NOT NULL DEFAULT 'v1.4.2',
    desired_state JSONB NOT NULL DEFAULT '{}',
    reported_state JSONB NOT NULL DEFAULT '{}',
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Telemetry Readings
CREATE TABLE IF NOT EXISTS public.telemetry_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
    temperature NUMERIC(5,2),
    humidity NUMERIC(5,2),
    occupancy BOOLEAN,
    power_watts NUMERIC(7,2),
    voltage NUMERIC(5,2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time ON public.telemetry_readings (device_id, recorded_at DESC);

-- 7. Automations
CREATE TABLE IF NOT EXISTS public.automations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type IN ('temperature_threshold', 'occupancy_change', 'schedule', 'power_threshold')),
    trigger_condition JSONB NOT NULL,
    action JSONB NOT NULL,
    interval_seconds INT NOT NULL DEFAULT 60,
    last_executed_at TIMESTAMPTZ,
    execution_count INT NOT NULL DEFAULT 0,
    notify_on_run BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Alerts
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
    acknowledged_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alerts_org_status ON public.alerts (organization_id, status);

-- 9. Events Log (Audit & Telemetry stream)
CREATE TABLE IF NOT EXISTS public.events_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    device_id UUID REFERENCES public.devices(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    actor_id UUID,
    actor_role VARCHAR(50),
    payload JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_org_created ON public.events_log (organization_id, created_at DESC);

-- 10. Firmware Packages
CREATE TABLE IF NOT EXISTS public.firmware_packages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version VARCHAR(50) NOT NULL,
    device_type VARCHAR(50) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    file_url TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'released' CHECK (status IN ('released', 'testing', 'deprecated')),
    changelog TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Firmware Rollouts
CREATE TABLE IF NOT EXISTS public.firmware_rollouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    firmware_id UUID NOT NULL REFERENCES public.firmware_packages(id) ON DELETE RESTRICT,
    target_type VARCHAR(50) NOT NULL,
    total_devices INT NOT NULL DEFAULT 0,
    updated_devices INT NOT NULL DEFAULT 0,
    failed_devices INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'paused', 'rolled_back')),
    progress_percent INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Integrations
CREATE TABLE IF NOT EXISTS public.integrations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('webhook', 'rest_api_key', 'simulated_mqtt')),
    endpoint_url TEXT,
    api_key_hash VARCHAR(128),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS) on all tables (SDE T19, T2598, T378)
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.firmware_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user organization
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS UUID AS $$
    SELECT organization_id FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper function to get current user role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS VARCHAR AS $$
    SELECT role FROM public.user_profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Policies for organizations
CREATE POLICY org_read_policy ON public.organizations
    FOR SELECT USING (id = public.current_user_org_id());

-- Policies for user_profiles
CREATE POLICY profile_read_policy ON public.user_profiles
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY profile_manage_policy ON public.user_profiles
    FOR ALL USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );

-- Policies for buildings
CREATE POLICY buildings_read_policy ON public.buildings
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY buildings_write_policy ON public.buildings
    FOR ALL USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );

-- Policies for rooms
CREATE POLICY rooms_read_policy ON public.rooms
    FOR SELECT USING (
        building_id IN (SELECT id FROM public.buildings WHERE organization_id = public.current_user_org_id())
    );

CREATE POLICY rooms_write_policy ON public.rooms
    FOR ALL USING (
        building_id IN (SELECT id FROM public.buildings WHERE organization_id = public.current_user_org_id()) AND
        public.current_user_role() IN ('owner', 'administrator')
    );

-- Policies for devices
CREATE POLICY devices_read_policy ON public.devices
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY devices_control_policy ON public.devices
    FOR UPDATE USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator', 'operator')
    );

CREATE POLICY devices_admin_policy ON public.devices
    FOR ALL USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );

-- Policies for telemetry_readings
CREATE POLICY telemetry_read_policy ON public.telemetry_readings
    FOR SELECT USING (
        device_id IN (SELECT id FROM public.devices WHERE organization_id = public.current_user_org_id())
    );

-- Policies for automations
CREATE POLICY automations_read_policy ON public.automations
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY automations_write_policy ON public.automations
    FOR ALL USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator', 'operator')
    );

-- Policies for alerts
CREATE POLICY alerts_read_policy ON public.alerts
    FOR SELECT USING (organization_id = public.current_user_org_id());

CREATE POLICY alerts_update_policy ON public.alerts
    FOR UPDATE USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator', 'operator')
    );

-- Policies for events_log
CREATE POLICY events_read_policy ON public.events_log
    FOR SELECT USING (organization_id = public.current_user_org_id());

-- Policies for firmware packages & rollouts (authenticated users can read; admins can manage)
CREATE POLICY firmware_read_policy ON public.firmware_packages
    FOR SELECT TO authenticated USING (true);

CREATE POLICY rollout_read_policy ON public.firmware_rollouts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY rollout_write_policy ON public.firmware_rollouts
    FOR ALL USING (public.current_user_role() IN ('owner', 'administrator'));

-- Policies for integrations
CREATE POLICY integrations_read_policy ON public.integrations
    FOR SELECT USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );

CREATE POLICY integrations_write_policy ON public.integrations
    FOR ALL USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );
