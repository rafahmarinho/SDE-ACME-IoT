import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// Shows why an action was refused (the server's authorization or validation answer, or connectivity).
export const ActionError: React.FC<{ message: string | null }> = ({ message }) => {
  if (!message) return null;
  return (
    <View style={styles.box}>
      <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#991b1b" />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
  },
  text: {
    flex: 1,
    fontSize: 12,
    color: '#991b1b',
    fontWeight: '600',
  },
});
