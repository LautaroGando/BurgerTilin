export const adminPushScope = '/admin';
export const registerAdminWorker = () =>
  navigator.serviceWorker.register('/admin-push-worker.js', { scope: adminPushScope });

export async function currentAdminSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(adminPushScope);
  return registration?.pushManager?.getSubscription() ?? null;
}
