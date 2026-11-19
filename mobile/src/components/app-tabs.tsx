import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { useAuth } from '@/auth/AuthContext';
import { useNotifications } from '@/components/notification-banner';
import { Colors } from '@/constants/theme';

// Home (scan), Products (likes + history), Manage (staff only) and Account.
// Manage is hidden for shoppers: app admins, store managers, buyers and clerks
// see it, with a badge for unread reorder notifications.
export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];
  const { hasPermission } = useAuth();
  const { unread } = useNotifications();
  const isStaff =
    hasPermission('view_inventory') ||
    hasPermission('manage_stock') ||
    hasPermission('manage_inventory') ||
    hasPermission('create_products') ||
    hasPermission('manage_store_admins') ||
    hasPermission('manage_store_staff');

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="products">
        <NativeTabs.Trigger.Label>Products</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bag" md="shopping_bag" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="manage" hidden={!isStaff}>
        <NativeTabs.Trigger.Label>Manage</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="briefcase" md="work" />
        {/* No badge at all when there's nothing unread */}
        {unread > 0 && <NativeTabs.Trigger.Badge>{unread > 99 ? '99+' : String(unread)}</NativeTabs.Trigger.Badge>}
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}