-- ACME IoT Demo Seed Data
-- 2 Organizations, 4 Users, 4 Buildings, 6 Rooms, 20 Devices, Automations, Alerts, Firmware Packages

-- Organizations
INSERT INTO public.organizations (id, name, slug, plan) VALUES
('11111111-1111-1111-1111-111111111111', 'ACME Global Headquarters', 'acme-hq', 'enterprise'),
('22222222-2222-2222-2222-222222222222', 'Nova Logistics & ColdChain', 'nova-logistics', 'industrial')
ON CONFLICT (id) DO NOTHING;

-- Buildings for ACME HQ
INSERT INTO public.buildings (id, organization_id, name, code, address, total_floors) VALUES
('b1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Tech Tower', 'TT-01', '500 Innovation Way, Silicon Valley, CA', 12),
('b1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Innovation Lab', 'IL-02', '520 Innovation Way, Silicon Valley, CA', 3),
-- Buildings for Nova Logistics
('b2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Central Fulfillment Depot', 'CFD-01', '880 Logistics Blvd, Dallas, TX', 2),
('b2222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Deep Cold Storage Facility', 'DCS-02', '900 Logistics Blvd, Dallas, TX', 1)
ON CONFLICT (id) DO NOTHING;

-- Rooms
INSERT INTO public.rooms (id, building_id, name, floor, room_number, type, dimensions) VALUES
('r1010000-0000-0000-0000-000000000001', 'b1111111-0000-0000-0000-000000000001', 'Executive Boardroom 101', 1, '101', 'conference', '{"width": 8, "length": 12, "height": 3.5}'),
('r1020000-0000-0000-0000-000000000002', 'b1111111-0000-0000-0000-000000000001', 'Data Center Alpha', 2, '204', 'server_room', '{"width": 14, "length": 20, "height": 4.0}'),
('r1030000-0000-0000-0000-000000000003', 'b1111111-0000-0000-0000-000000000001', 'Engineering Open Space', 4, '401', 'office', '{"width": 18, "length": 26, "height": 3.5}'),
('r1040000-0000-0000-0000-000000000004', 'b1111111-0000-0000-0000-000000000002', 'IoT Hardware Sandbox', 1, '110', 'lab', '{"width": 10, "length": 14, "height": 3.2}'),
('r2010000-0000-0000-0000-000000000001', 'b2222222-0000-0000-0000-000000000001', 'Sorting Bay 04', 1, 'SB-04', 'warehouse', '{"width": 30, "length": 50, "height": 8.0}'),
('r2020000-0000-0000-0000-000000000002', 'b2222222-0000-0000-0000-000000000002', 'Cryo Vault A', 1, 'CV-01', 'cold_storage', '{"width": 12, "length": 18, "height": 4.5}')
ON CONFLICT (id) DO NOTHING;

-- 20 Devices
INSERT INTO public.devices (id, organization_id, building_id, room_id, name, code, type, status, battery_level, rssi, firmware_version, desired_state, reported_state) VALUES
-- Devices 1-3 in Executive Boardroom 101
('d0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1010000-0000-0000-0000-000000000001', 'Boardroom Smart Thermostat', 'HQ-TH-101', 'thermostat', 'online', 94, -58, 'v1.4.2', '{"target_temp": 21.5, "mode": "cooling"}', '{"current_temp": 21.8, "mode": "cooling", "fan_speed": "auto"}'),
('d0000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1010000-0000-0000-0000-000000000001', 'Boardroom PIR Occupancy', 'HQ-OC-101', 'occupancy_sensor', 'online', 88, -62, 'v1.2.0', '{"sensitivity": "high"}', '{"occupied": true, "motion_detected_at": "2026-10-12T10:00:00Z"}'),
('d0000003-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1010000-0000-0000-0000-000000000001', 'Boardroom AV Display Plug', 'HQ-PL-101', 'smart_plug', 'online', 100, -52, 'v2.1.0', '{"power": "on"}', '{"power": "on", "power_watts": 340.5, "voltage": 120.2}'),

-- Devices 4-7 in Data Center Alpha
('d0000004-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1020000-0000-0000-0000-000000000002', 'Precision CRAC Thermostat', 'HQ-TH-201', 'thermostat', 'online', 100, -45, 'v1.4.2', '{"target_temp": 19.0, "mode": "cooling"}', '{"current_temp": 19.2, "mode": "cooling", "fan_speed": "high"}'),
('d0000005-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1020000-0000-0000-0000-000000000002', 'Hot Aisle Thermal Probe', 'HQ-TM-202', 'temperature_sensor', 'online', 91, -48, 'v1.1.4', '{"sampling_rate": 10}', '{"current_temp": 28.4}'),
('d0000006-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1020000-0000-0000-0000-000000000002', 'Server Room Hygrometer', 'HQ-HM-203', 'humidity_sensor', 'online', 86, -55, 'v1.1.4', '{"sampling_rate": 15}', '{"humidity": 44.5}'),
('d0000007-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1020000-0000-0000-0000-000000000002', 'Rack B04 Auxiliary Outlet', 'HQ-PL-204', 'smart_plug', 'online', 100, -42, 'v2.1.0', '{"power": "on"}', '{"power": "on", "power_watts": 850.0, "voltage": 121.0}'),

-- Devices 8-10 in Engineering Open Space
('d0000008-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1030000-0000-0000-0000-000000000003', 'Floor 4 Zone HVAC', 'HQ-TH-401', 'thermostat', 'online', 100, -68, 'v1.4.2', '{"target_temp": 22.0, "mode": "cooling"}', '{"current_temp": 22.4, "mode": "cooling", "fan_speed": "auto"}'),
('d0000009-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1030000-0000-0000-0000-000000000003', 'Engineering Hallway Motion', 'HQ-OC-402', 'occupancy_sensor', 'online', 18, -75, 'v1.2.0', '{"sensitivity": "medium"}', '{"occupied": true, "motion_detected_at": "2026-10-12T10:10:00Z"}'),
('d0000010-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000001', 'r1030000-0000-0000-0000-000000000003', 'Espresso Machine Smart Bar', 'HQ-PL-403', 'smart_plug', 'online', 100, -60, 'v2.1.0', '{"power": "on"}', '{"power": "on", "power_watts": 1250.0, "voltage": 119.8}'),

-- Devices 11-13 in Innovation Lab
('d0000011-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000002', 'r1040000-0000-0000-0000-000000000004', 'Lab Environmental Monitor', 'IL-TM-101', 'temperature_sensor', 'online', 74, -58, 'v1.1.4', '{"sampling_rate": 30}', '{"current_temp": 23.5}'),
('d0000012-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000002', 'r1040000-0000-0000-0000-000000000004', 'Soldering Station Bench Outlet', 'IL-PL-102', 'smart_plug', 'online', 100, -56, 'v2.1.0', '{"power": "off"}', '{"power": "off", "power_watts": 0.0, "voltage": 120.1}'),
('d0000013-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'b1111111-0000-0000-0000-000000000002', 'r1040000-0000-0000-0000-000000000004', 'Lab Access Radar Sensor', 'IL-OC-103', 'occupancy_sensor', 'offline', 12, -92, 'v1.2.0', '{"sensitivity": "high"}', '{"occupied": false}'),

-- Devices 14-16 in Sorting Bay 04 (Nova Logistics)
('d0000014-0000-0000-0000-000000000014', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000001', 'r2010000-0000-0000-0000-000000000001', 'Conveyor Belt Infeed Plug', 'NV-PL-101', 'smart_plug', 'online', 100, -62, 'v2.1.0', '{"power": "on"}', '{"power": "on", "power_watts": 2100.0, "voltage": 208.5}'),
('d0000015-0000-0000-0000-000000000015', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000001', 'r2010000-0000-0000-0000-000000000001', 'Dock Door 4 Optical Beam', 'NV-OC-102', 'occupancy_sensor', 'online', 82, -67, 'v1.2.0', '{"sensitivity": "high"}', '{"occupied": true, "motion_detected_at": "2026-10-12T10:14:00Z"}'),
('d0000016-0000-0000-0000-000000000016', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000001', 'r2010000-0000-0000-0000-000000000001', 'High-Bay Thermal Node', 'NV-TM-103', 'temperature_sensor', 'online', 65, -71, 'v1.1.4', '{"sampling_rate": 60}', '{"current_temp": 24.8}'),

-- Devices 17-20 in Cryo Vault A (Nova Logistics)
('d0000017-0000-0000-0000-000000000017', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000002', 'r2020000-0000-0000-0000-000000000002', 'Cryogenic Chiller Controller', 'NV-TH-201', 'thermostat', 'online', 100, -50, 'v1.4.2', '{"target_temp": -22.0, "mode": "cooling"}', '{"current_temp": -21.4, "mode": "cooling", "fan_speed": "high"}'),
('d0000018-0000-0000-0000-000000000018', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000002', 'r2020000-0000-0000-0000-000000000002', 'Sub-Zero Probe 01', 'NV-TM-202', 'temperature_sensor', 'online', 92, -54, 'v1.1.4', '{"sampling_rate": 5}', '{"current_temp": -22.1}'),
('d0000019-0000-0000-0000-000000000019', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000002', 'r2020000-0000-0000-0000-000000000002', 'Frost Barrier Hygrometer', 'NV-HM-203', 'humidity_sensor', 'warning', 25, -78, 'v1.1.4', '{"sampling_rate": 15}', '{"humidity": 78.2}'),
('d0000020-0000-0000-0000-000000000020', '22222222-2222-2222-2222-222222222222', 'b2222222-0000-0000-0000-000000000002', 'r2020000-0000-0000-0000-000000000002', 'Emergency Defrost Circuit Plug', 'NV-PL-204', 'smart_plug', 'online', 100, -58, 'v2.1.0', '{"power": "off"}', '{"power": "off", "power_watts": 0.0, "voltage": 208.1}')
ON CONFLICT (id) DO NOTHING;

-- Initial Automations
INSERT INTO public.automations (id, organization_id, name, enabled, trigger_type, trigger_condition, action, interval_seconds, notify_on_run) VALUES
('a0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Server Room Overheat Safeguard', true, 'temperature_threshold', '{"device_id": "d0000005-0000-0000-0000-000000000005", "metric": "current_temp", "operator": ">=", "value": 26.0}', '{"target_device_id": "d0000004-0000-0000-0000-000000000004", "command": "set_target_temp", "value": 18.0}', 120, true),
('a0000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Boardroom Energy Saver on Vacancy', true, 'occupancy_change', '{"device_id": "d0000002-0000-0000-0000-000000000002", "metric": "occupied", "operator": "==", "value": false}', '{"target_device_id": "d0000003-0000-0000-0000-000000000003", "command": "set_power", "value": "off"}', 300, true),
('a0000003-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Cryo Vault High Temp Safety Alarm', true, 'temperature_threshold', '{"device_id": "d0000018-0000-0000-0000-000000000018", "metric": "current_temp", "operator": ">=", "value": -18.0}', '{"target_device_id": "d0000017-0000-0000-0000-000000000017", "command": "set_target_temp", "value": -24.0}', 60, true)
ON CONFLICT (id) DO NOTHING;

-- Initial Alerts
INSERT INTO public.alerts (id, organization_id, device_id, severity, title, message, status) VALUES
('al000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd0000013-0000-0000-0000-000000000013', 'warning', 'Device Offline Detected', 'Lab Access Radar Sensor (IL-OC-103) missed 3 consecutive heartbeat intervals.', 'active'),
('al000002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd0000009-0000-0000-0000-000000000009', 'warning', 'Low Battery Threshold', 'Engineering Hallway Motion (HQ-OC-402) battery dropped to 18%.', 'active'),
('al000003-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'd0000019-0000-0000-0000-000000000019', 'critical', 'High Humidity Anomaly in Cold Storage', 'Frost Barrier Hygrometer reported 78.2% RH in Cryo Vault A.', 'active')
ON CONFLICT (id) DO NOTHING;

-- Firmware Packages
INSERT INTO public.firmware_packages (id, version, device_type, checksum_sha256, file_size_bytes, file_url, status, changelog) VALUES
('f0000001-0000-0000-0000-000000000001', 'v1.4.3', 'thermostat', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 1048576, 'https://storage.acme-iot.internal/firmware/thermostat-v1.4.3.bin', 'released', 'Improves PID deadband control and BLE signal reliability.'),
('f0000002-0000-0000-0000-000000000002', 'v2.1.2', 'smart_plug', '872983ac1324fae1098273645bbcddeeeef42345678901234567890123456789', 524288, 'https://storage.acme-iot.internal/firmware/smartplug-v2.1.2.bin', 'released', 'Fixes energy meter drift at low amperage and adds surge telemetry.'),
('f0000003-0000-0000-0000-000000000003', 'v1.2.2', 'occupancy_sensor', '99887766554433221100aabbccddeeff00112233445566778899aabbccddeeff', 786432, 'https://storage.acme-iot.internal/firmware/occupancy-v1.2.2.bin', 'testing', 'Reduces false-positives under variable fluorescent lighting.')
ON CONFLICT (id) DO NOTHING;

-- Initial Firmware Rollout
INSERT INTO public.firmware_rollouts (id, firmware_id, target_type, total_devices, updated_devices, failed_devices, status, progress_percent) VALUES
('ro000001-0000-0000-0000-000000000001', 'f0000001-0000-0000-0000-000000000001', 'thermostat', 4, 2, 0, 'in_progress', 50)
ON CONFLICT (id) DO NOTHING;

-- Initial Integrations
INSERT INTO public.integrations (id, organization_id, name, type, endpoint_url, active) VALUES
('i0000001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Slack Operations Incident Channel', 'webhook', 'https://hooks.slack.com/services/T00/B00/XXXX', true),
('i0000002-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Enterprise SIEM Log Stream', 'rest_api_key', 'https://siem.acme-iot.internal/api/v1/ingest', true)
ON CONFLICT (id) DO NOTHING;
