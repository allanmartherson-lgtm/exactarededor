export interface AppNotification {
  id: string;
  title: string;
  description?: string;
  kind: "info" | "warning" | "success";
  paymentId: string;
  createdAt: Date;
  read: boolean;
}

let notifications: AppNotification[] = [];
let listeners: Array<() => void> = [];

export const notificationStore = {
  get: () => notifications,
  add: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => {
    notifications = [
      { ...n, id: crypto.randomUUID(), createdAt: new Date(), read: false },
      ...notifications,
    ].slice(0, 50);
    listeners.forEach((l) => l());
  },
  markAllRead: () => {
    notifications = notifications.map((n) => ({ ...n, read: true }));
    listeners.forEach((l) => l());
  },
  subscribe: (fn: () => void) => {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  },
};
