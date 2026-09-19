import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useNotifications } from '@/lib/queries';
import { colors } from '@/lib/theme';

export function NotificationBell() {
  const router = useRouter();
  const { data = [] } = useNotifications();
  const unread = data.filter((n) => !n.read_at).length;
  return (
    <Pressable onPress={() => router.push('/notifications')} hitSlop={10} style={styles.btn}>
      <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={22} color={colors.text} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeTxt}>{unread > 9 ? '9+' : unread}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.live,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeTxt: { color: '#fff', fontSize: 9, fontWeight: '800' },
});
