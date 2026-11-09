import { authenticatedFetch } from "./client";
import type { Role, StaffRole } from "./general";

export type StaffStore = {
  store_id: number; name: string; address: string; allowed_roles: StaffRole[];
};
export type StaffPerson = { user_id: number; email: string; role: Role };
export type StaffAssignment = StaffPerson & { store_id: number; role: StaffRole };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/admin/staff${path}`, options);
  if (!response.ok) {
    let message = `Could not complete the request (HTTP ${response.status}).`;
    try {
      const data: { detail?: string | { msg?: string }[] } = await response.json();
      if (typeof data.detail === "string") message = data.detail;
      else if (Array.isArray(data.detail)) message = data.detail.map((item) => item.msg ?? "Invalid value").join("; ");
    } catch { /* Keep the HTTP message for non-JSON responses. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function getStaffStores(): Promise<StaffStore[]> {
  return (await request<{ stores: StaffStore[] }>("/options")).stores;
}

export async function getStaff(storeId: number, offset: number, limit: number) {
  const result = await request<{ users: (StaffPerson & { role: StaffRole })[] }>(
    `?store_id=${storeId}&offset=${offset}&limit=${limit}`,
  );
  if (!Array.isArray(result.users)) {
    throw new Error("Invalid staff response: expected a users list.");
  }
  return result.users.map((person) => ({ ...person, store_id: storeId }));
}

export async function findStaffCandidates(storeId: number, query: string, offset: number, limit: number): Promise<StaffPerson[]> {
  return (await request<{ users: StaffPerson[] }>(
    `/candidates?store_id=${storeId}&q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`,
  )).users;
}

export function setStaffRole(userId: number, storeId: number, role: StaffRole) {
  return request<StaffAssignment>(`/${userId}/stores/${storeId}`, {
    method: "PUT", body: JSON.stringify({ role }),
  });
}

export function removeStaffRole(userId: number, storeId: number) {
  return request<StaffAssignment>(`/${userId}/stores/${storeId}`, { method: "DELETE" });
}
