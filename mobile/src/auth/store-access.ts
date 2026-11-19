import type { User } from "../api/general";

export function canAccessStore(profile: User | null, storeId: number): boolean {
  return !!profile && Number.isSafeInteger(storeId) && storeId > 0 &&
    (profile.permissions.includes("manage_all_stores") || profile.store_ids.includes(storeId));
}
