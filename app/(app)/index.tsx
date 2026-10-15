import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

export default function AppIndex() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/(app)/dashboard');
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#4f46e5" />
    </View>
  );
}
