import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface OfflineNoticeProps {
  isOffline: boolean;
}

export const OfflineNotice: React.FC<OfflineNoticeProps> = ({ isOffline }) => {
  if (!isOffline) return null;

  return (
    <View style={styles.banner}>
      <MaterialCommunityIcons name="cloud-off-outline" size={18} color="#991b1b" style={styles.icon} />
      <View style={styles.textContainer}>
        <Text style={styles.title}>Offline Read-Only View</Text>
        <Text style={styles.subtitle}>
          Displaying cached telemetry. Background sync is paused. Device control actions require an active connection.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  subtitle: {
    fontSize: 11,
    color: '#b91c1c',
    marginTop: 2,
  },
});
