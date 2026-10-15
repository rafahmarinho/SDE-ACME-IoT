import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const s = status.toLowerCase();

  let bg = '#e0e7ff';
  let text = '#4338ca';

  if (s === 'online' || s === 'completed' || s === 'released' || s === 'active') {
    bg = '#dcfce7';
    text = '#15803d';
  } else if (s === 'offline' || s === 'critical' || s === 'failed') {
    bg = '#fee2e2';
    text = '#b91c1c';
  } else if (s === 'warning' || s === 'paused' || s === 'testing') {
    bg = '#fef3c7';
    text = '#b45309';
  } else if (s === 'updating' || s === 'in_progress') {
    bg = '#e0e7ff';
    text = '#4338ca';
  } else if (s === 'rolled_back') {
    bg = '#f3e8ff';
    text = '#7e22ce';
  }

  const isSmall = size === 'sm';

  return (
    <View style={[styles.badge, { backgroundColor: bg }, isSmall && styles.badgeSm]}>
      <View style={[styles.dot, { backgroundColor: text }]} />
      <Text style={[styles.label, { color: text }, isSmall && styles.labelSm]}>
        {status.toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  labelSm: {
    fontSize: 9,
  },
});
