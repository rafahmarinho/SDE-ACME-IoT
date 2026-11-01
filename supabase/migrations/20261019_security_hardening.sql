-- ACME IoT security hardening (SD Elements T19, T2598, T2597, T14, T2664, T18)
-- Additive migration applied after 20261012_init_schema.sql (applied migrations are never edited).

-- 1. SECURITY DEFINER helpers: pin search_path so objects in other schemas cannot hijack them,
--    and keep them away from the anonymous role.
ALTER FUNCTION public.current_user_org_id() SET search_path = '';
ALTER FUNCTION public.current_user_role() SET search_path = '';
REVOKE EXECUTE ON FUNCTION public.current_user_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- 2. New profiles default to the least-privileged role.
ALTER TABLE public.user_profiles ALTER COLUMN role SET DEFAULT 'viewer';

-- 3. Role management. The former FOR ALL policy had no WITH CHECK, so an administrator could
--    promote anyone (including themselves) to owner. Owners manage every other profile in their
--    organization; administrators only operator/viewer profiles; nobody changes their own role
--    or moves a profile to another organization.
DROP POLICY IF EXISTS profile_manage_policy ON public.user_profiles;

CREATE POLICY profile_insert_policy ON public.user_profiles
    FOR INSERT TO authenticated
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        (public.current_user_role() = 'owner' OR
         (public.current_user_role() = 'administrator' AND role IN ('operator', 'viewer')))
    );

CREATE POLICY profile_update_policy ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (
        id <> auth.uid() AND
        organization_id = public.current_user_org_id() AND
        (public.current_user_role() = 'owner' OR
         (public.current_user_role() = 'administrator' AND role IN ('operator', 'viewer')))
    )
    WITH CHECK (
        id <> auth.uid() AND
        organization_id = public.current_user_org_id() AND
        (public.current_user_role() = 'owner' OR
         (public.current_user_role() = 'administrator' AND role IN ('operator', 'viewer')))
    );

-- Users may correct their own profile data, but role and organization must stay unchanged
-- (current_user_role() reads the row as it was before the statement).
CREATE POLICY profile_self_update_policy ON public.user_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (
        id = auth.uid() AND
        role = public.current_user_role() AND
        organization_id = public.current_user_org_id()
    );

CREATE POLICY profile_delete_policy ON public.user_profiles
    FOR DELETE TO authenticated
    USING (
        id <> auth.uid() AND
        organization_id = public.current_user_org_id() AND
        (public.current_user_role() = 'owner' OR
         (public.current_user_role() = 'administrator' AND role IN ('operator', 'viewer')))
    );

-- 4. Firmware rollouts are tenant data: every read and write is scoped to the caller's
--    organization (rollout_write_policy previously let an admin of any tenant change all rollouts).
ALTER TABLE public.firmware_rollouts
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_rollouts_org ON public.firmware_rollouts (organization_id);
-- New and updated rows must name their organization; legacy rows without one stay hidden (fail closed).
ALTER TABLE public.firmware_rollouts
    ADD CONSTRAINT firmware_rollouts_org_required CHECK (organization_id IS NOT NULL) NOT VALID;

DROP POLICY IF EXISTS rollout_read_policy ON public.firmware_rollouts;
DROP POLICY IF EXISTS rollout_write_policy ON public.firmware_rollouts;

CREATE POLICY rollout_read_policy ON public.firmware_rollouts
    FOR SELECT TO authenticated
    USING (organization_id = public.current_user_org_id());

CREATE POLICY rollout_write_policy ON public.firmware_rollouts
    FOR ALL TO authenticated
    USING (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    )
    WITH CHECK (
        organization_id = public.current_user_org_id() AND
        public.current_user_role() IN ('owner', 'administrator')
    );

-- 5. Column-level least privilege: operators may only change a device's desired state.
CREATE OR REPLACE FUNCTION public.enforce_operator_device_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF public.current_user_role() = 'operator'
       AND (to_jsonb(NEW) - 'desired_state') IS DISTINCT FROM (to_jsonb(OLD) - 'desired_state') THEN
        RAISE EXCEPTION 'operators can only change desired_state' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enforce_operator_device_update() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS devices_operator_column_guard ON public.devices;
CREATE TRIGGER devices_operator_column_guard
    BEFORE UPDATE ON public.devices
    FOR EACH ROW EXECUTE FUNCTION public.enforce_operator_device_update();

-- 6. Table privileges: the anonymous role reads nothing, signed-in users only keep the actions the
--    app needs (RLS still filters every row), and TRUNCATE (which bypasses RLS) is removed.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
-- Written only by the platform (service role): read-only for end users.
REVOKE INSERT, UPDATE, DELETE ON public.organizations, public.telemetry_readings, public.events_log, public.firmware_packages FROM authenticated;
-- Alerts are raised by the platform; users only acknowledge or resolve them.
REVOKE INSERT, DELETE ON public.alerts FROM authenticated;

-- 7. Custom access token hook: adds the caller's organization (org_id) and application role
--    (user_role) to the access token so the API (api/_lib/security.ts) can authorize requests
--    with the full security context. Enable it in Supabase Dashboard > Authentication > Hooks.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    claims jsonb;
    profile_org uuid;
    profile_role text;
BEGIN
    SELECT organization_id, role INTO profile_org, profile_role
    FROM public.user_profiles
    WHERE id = (event ->> 'user_id')::uuid;

    claims := event -> 'claims';
    IF profile_org IS NOT NULL AND profile_role IS NOT NULL THEN
        claims := jsonb_set(claims, '{org_id}', to_jsonb(profile_org::text));
        claims := jsonb_set(claims, '{user_role}', to_jsonb(profile_role));
    ELSE
        claims := claims - 'org_id' - 'user_role';
    END IF;
    RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_profiles TO supabase_auth_admin;

CREATE POLICY profile_auth_hook_read_policy ON public.user_profiles
    AS PERMISSIVE FOR SELECT TO supabase_auth_admin
    USING (true);
