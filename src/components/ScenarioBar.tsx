import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AppStorage } from '../services/storage';
import { SimulationEngine, subscribeToSimulation } from '../services/simulation';
import { SimulationScenario } from '../types';

export const ScenarioBar: React.FC<{ onReset?: () => void }> = ({ onReset }) => {
  const [scenario, setScenario] = useState<SimulationScenario>(AppStorage.getScenario());
  const [isSimRunning, setIsSimRunning] = useState<boolean>(SimulationEngine.isActive());
  const [isOffline, setIsOffline] = useState<boolean>(AppStorage.isOfflineMode());

  useEffect(() => {
    return subscribeToSimulation(() => {
      setScenario(AppStorage.getScenario());
      setIsOffline(AppStorage.isOfflineMode());
    });
  }, []);

  const handleScenarioChange = (s: SimulationScenario) => {
    setScenario(s);
    SimulationEngine.setScenario(s);
  };

  const handleAdvance = () => {
    SimulationEngine.advanceTick();
  };

  const handleToggleTimer = () => {
    if (isSimRunning) {
      SimulationEngine.stop();
      setIsSimRunning(false);
    } else {
      SimulationEngine.start(3000);
      setIsSimRunning(true);
    }
  };

  const handleToggleOffline = () => {
    const next = !isOffline;
    setIsOffline(next);
    AppStorage.setOfflineMode(next);
  };

  const handleReset = () => {
    AppStorage.resetToDemoData();
    setScenario('normal');
    setIsOffline(false);
    if (onReset) onReset();
  };

  const scenarios: { id: SimulationScenario; label: string; icon: any }[] = [
    { id: 'normal', label: 'Normal', icon: 'shield-check-outline' },
    { id: 'heatwave', label: 'Heatwave', icon: 'weather-sunny-alert' },
    { id: 'network_jitter', label: 'Network Flap', icon: 'wifi-alert' },
    { id: 'battery_drain', label: 'Battery Drain', icon: 'battery-alert-variant-outline' },
    { id: 'firmware_wave', label: 'OTA Wave', icon: 'cloud-upload-outline' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleWrap}>
          <MaterialCommunityIcons name="speedometer" size={18} color="#4f46e5" />
          <Text style={styles.title}>Simulation Engine & Scenarios</Text>
        </View>

        <View style={styles.actionGroup}>
          <TouchableOpacity
            style={[styles.btn, isOffline ? styles.btnOfflineActive : styles.btnSecondary]}
            onPress={handleToggleOffline}
          >
            <MaterialCommunityIcons
              name={isOffline ? 'cloud-off-outline' : 'cloud-check'}
              size={15}
              color={isOffline ? '#ffffff' : '#4f46e5'}
            />
            <Text style={[styles.btnText, isOffline && { color: '#ffffff' }]}>
              {isOffline ? 'Offline' : 'Online'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAdvance}>
            <MaterialCommunityIcons name="step-forward" size={15} color="#ffffff" />
            <Text style={[styles.btnText, { color: '#ffffff' }]}>Advance Tick</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, isSimRunning ? styles.btnWarning : styles.btnSecondary]}
            onPress={handleToggleTimer}
          >
            <MaterialCommunityIcons
              name={isSimRunning ? 'pause' : 'play'}
              size={15}
              color={isSimRunning ? '#ffffff' : '#4f46e5'}
            />
            <Text style={[styles.btnText, isSimRunning && { color: '#ffffff' }]}>
              {isSimRunning ? 'Pause' : 'Auto Play'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.btnOutline]} onPress={handleReset}>
            <MaterialCommunityIcons name="backup-restore" size={15} color="#475569" />
            <Text style={[styles.btnText, { color: '#475569' }]}>Reset Demo</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scenariosRow}>
        {scenarios.map((sc) => {
          const selected = scenario === sc.id;
          return (
            <TouchableOpacity
              key={sc.id}
              style={[styles.scenarioChip, selected && styles.scenarioChipSelected]}
              onPress={() => handleScenarioChange(sc.id)}
            >
              <MaterialCommunityIcons
                name={sc.icon}
                size={14}
                color={selected ? '#ffffff' : '#475569'}
              />
              <Text style={[styles.scenarioChipText, selected && styles.scenarioChipTextSelected]}>
                {sc.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  btnPrimary: {
    backgroundColor: '#4f46e5',
  },
  btnSecondary: {
    backgroundColor: '#eef2ff',
  },
  btnWarning: {
    backgroundColor: '#ea580c',
  },
  btnOfflineActive: {
    backgroundColor: '#dc2626',
  },
  btnOutline: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  btnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4f46e5',
  },
  scenariosRow: {
    marginTop: 8,
    flexDirection: 'row',
  },
  scenarioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
    marginRight: 8,
  },
  scenarioChipSelected: {
    backgroundColor: '#4f46e5',
  },
  scenarioChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  scenarioChipTextSelected: {
    color: '#ffffff',
  },
});
