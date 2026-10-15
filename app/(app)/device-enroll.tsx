import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../../src/services/storage';
import { SimulationEngine } from '../../src/services/simulation';
import { DeviceType } from '../../src/types';

export default function DeviceEnrollScreen() {
  const router = useRouter();
  const orgId = AppStorage.getActiveOrgId();
  const buildings = AppStorage.getBuildings().filter((b) => b.organizationId === orgId);
  const rooms = AppStorage.getRooms();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<DeviceType>('thermostat');
  const [buildingId, setBuildingId] = useState(buildings[0]?.id || '');
  const [roomId, setRoomId] = useState('');
  const [qrSimulating, setQrSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Available rooms for selected building
  const buildingRooms = rooms.filter((r) => r.buildingId === buildingId);

  // Update room when building changes
  React.useEffect(() => {
    if (buildingRooms.length > 0 && !buildingRooms.some((r) => r.id === roomId)) {
      setRoomId(buildingRooms[0].id);
    }
  }, [buildingId]);

  // Simulate scanning a physical hardware QR Code tag
  const handleSimulateQRScan = () => {
    setQrSimulating(true);
    setError(null);

    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const mockQRData = [
      { name: 'Conference Room Temp Node', code: `ACME-TM-${randomSuffix}`, type: 'temperature_sensor' as DeviceType },
      { name: 'Executive Suite Plug', code: `ACME-PL-${randomSuffix}`, type: 'smart_plug' as DeviceType },
      { name: 'Zone 4 Wall HVAC Unit', code: `ACME-TH-${randomSuffix}`, type: 'thermostat' as DeviceType },
      { name: 'Stairwell Radar Occupancy', code: `ACME-OC-${randomSuffix}`, type: 'occupancy_sensor' as DeviceType },
      { name: 'Server Rack Hygrometer', code: `ACME-HM-${randomSuffix}`, type: 'humidity_sensor' as DeviceType },
    ];

    setTimeout(() => {
      const sample = mockQRData[Math.floor(Math.random() * mockQRData.length)];
      setName(sample.name);
      setCode(sample.code);
      setType(sample.type);
      setQrSimulating(false);
      setSuccess(`QR code scanned successfully! Verified digital signature for payload ${sample.code}.`);
    }, 700);
  };

  const handleEnroll = () => {
    setError(null);
    setSuccess(null);

    if (!name.trim()) {
      setError('Please provide a descriptive device name.');
      return;
    }
    if (!code.trim() || code.length < 4) {
      setError('Please provide a valid device identification code (at least 4 characters).');
      return;
    }
    if (!buildingId || !roomId) {
      setError('Please select a target facility building and room.');
      return;
    }

    const res = SimulationEngine.enrollDevice({
      name: name.trim(),
      code: code.trim(),
      type,
      buildingId,
      roomId,
      organizationId: orgId,
    });

    if (!res.success) {
      setError(res.error || 'Failed to enroll device');
      return;
    }

    setSuccess(`Device ${code.toUpperCase()} successfully provisioned and connected to the IoT mesh!`);
    setTimeout(() => {
      router.replace('/(app)/devices');
    }, 1200);
  };

  const deviceTypes: { id: DeviceType; label: string; icon: any }[] = [
    { id: 'thermostat', label: 'Thermostat', icon: 'thermostat' },
    { id: 'smart_plug', label: 'Smart Plug', icon: 'power-socket-us' },
    { id: 'temperature_sensor', label: 'Temp Sensor', icon: 'thermometer' },
    { id: 'humidity_sensor', label: 'Humidity Sensor', icon: 'water-percent' },
    { id: 'occupancy_sensor', label: 'Occupancy Sensor', icon: 'motion-sensor' },
  ];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
        <MaterialCommunityIcons name="arrow-left" size={18} color="#4f46e5" />
        <Text style={styles.backBtnText}>Back to Device Directory</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="qrcode-scan" size={26} color="#4f46e5" />
          </View>
          <View>
            <Text style={styles.title}>Provision & Enroll Device</Text>
            <Text style={styles.subtitle}>
              Register a hardware sensor or actuator using optical QR scan or manual provisioning
            </Text>
          </View>
        </View>

        {/* QR Scan simulator action card */}
        <View style={styles.qrBanner}>
          <View style={styles.qrBannerIconWrap}>
            <MaterialCommunityIcons name="camera-iris" size={32} color="#4f46e5" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.qrBannerTitle}>Instant Hardware Provisioning</Text>
            <Text style={styles.qrBannerSub}>
              Scan the factory QR code sticker on the chassis or trigger the optical camera simulator.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.qrScanBtn}
            onPress={handleSimulateQRScan}
            disabled={qrSimulating}
          >
            {qrSimulating ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <>
                <MaterialCommunityIcons name="barcode-scan" size={16} color="#ffffff" />
                <Text style={styles.qrScanBtnText}>Scan QR Code</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#991b1b" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {success && (
          <View style={styles.successBox}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color="#15803d" />
            <Text style={styles.successText}>{success}</Text>
          </View>
        )}

        {/* Form fields */}
        <View style={styles.formSection}>
          <Text style={styles.label}>Device Type</Text>
          <View style={styles.typeGrid}>
            {deviceTypes.map((t) => {
              const selected = type === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.typeBtn, selected && styles.typeBtnSelected]}
                  onPress={() => setType(t.id)}
                >
                  <MaterialCommunityIcons
                    name={t.icon}
                    size={20}
                    color={selected ? '#ffffff' : '#4f46e5'}
                  />
                  <Text style={[styles.typeBtnText, selected && styles.typeBtnTextSelected]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Device Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Executive Boardroom Thermostat"
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Unique Hardware Code / Serial</Text>
            <TextInput
              style={[styles.input, { fontFamily: 'monospace' }]}
              placeholder="e.g. HQ-TH-901"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
            />
          </View>

          {/* Building Selection */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Building Assignment</Text>
            <View style={styles.optionsWrap}>
              {buildings.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={[styles.optionChip, buildingId === b.id && styles.optionChipSelected]}
                  onPress={() => setBuildingId(b.id)}
                >
                  <Text
                    style={[styles.optionChipText, buildingId === b.id && styles.optionChipTextSelected]}
                  >
                    {b.name} ({b.code})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Room Selection */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Room Placement</Text>
            <View style={styles.optionsWrap}>
              {buildingRooms.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.optionChip, roomId === r.id && styles.optionChipSelected]}
                  onPress={() => setRoomId(r.id)}
                >
                  <Text
                    style={[styles.optionChipText, roomId === r.id && styles.optionChipTextSelected]}
                  >
                    {r.name} (#{r.roomNumber})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity style={styles.submitBtn} onPress={handleEnroll}>
            <MaterialCommunityIcons name="plus-circle" size={18} color="#ffffff" />
            <Text style={styles.submitBtnText}>Complete Device Enrollment</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#f8fafc',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4f46e5',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 24,
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  qrBanner: {
    backgroundColor: '#f5f3ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  qrBannerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  qrBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4f46e5',
  },
  qrBannerSub: {
    fontSize: 11,
    color: '#475569',
    marginTop: 2,
  },
  qrScanBtn: {
    backgroundColor: '#4f46e5',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  qrScanBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '500',
    flex: 1,
  },
  successBox: {
    backgroundColor: '#dcfce7',
    padding: 12,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  successText: {
    fontSize: 12,
    color: '#15803d',
    fontWeight: '500',
    flex: 1,
  },
  formSection: {
    gap: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  typeBtnSelected: {
    backgroundColor: '#4f46e5',
    borderColor: '#4f46e5',
  },
  typeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  typeBtnTextSelected: {
    color: '#ffffff',
  },
  inputGroup: {
    marginTop: 4,
  },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
  },
  optionsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  optionChipSelected: {
    backgroundColor: '#eef2ff',
    borderColor: '#4f46e5',
  },
  optionChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  optionChipTextSelected: {
    color: '#4f46e5',
    fontWeight: '700',
  },
  submitBtn: {
    backgroundColor: '#4f46e5',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    marginTop: 10,
  },
  submitBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
