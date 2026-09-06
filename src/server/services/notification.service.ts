import '@/server/only';
import { and, desc, eq, sql, lt } from 'drizzle-orm';
import { db } from '@/server/db/client';
import { notifications } from '@/server/db/schema';

export type NotificationType =
  | 'REFERRAL_CREATED' | 'REFERRAL_ACCEPTED' | 'REFERRAL_DECLINED'
  | 'REFERRAL_INFORMATION_REQUESTED' | 'REFERRAL_RESPONSE' | 'REFERRAL_COMPLETED'
  | 'CRITICAL_LAB_RESULT' | 'LAB_RESULT_AVAILABLE' | 'RADIOLOGY_REPORT_AVAILABLE'
  | 'VITALS_RECORDED' | 'MEDICATION_UPDATED' | 'MEDICATION_DISPENSED'
  | 'PATIENT_ADMITTED' | 'PATIENT_TRANSFERRED' | 'MESSAGE_RECEIVED' | 'SYSTEM';

export type NotifyInput = {
  recipientId: string;
  patientId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  referenceType?: string | null;
  referenceId?: string | null;
  link?: string | null;
  severity?: 'INFO' | 'ATTENTION' | 'CRITICAL';
};

export async function notify(input: NotifyInput): Promise<void> {
  await db.insert(notifications).values({
    recipientId: input.recipientId,
    patientId: input.patientId ?? null,
    type: input.type,
    title: input.title,
    message: input.message,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    link: input.link ?? null,
    severity: input.severity ?? 'INFO',
  });
}

export async function notifyMany(recipients: string[], input: Omit<NotifyInput, 'recipientId'>): Promise<void> {
  const unique = [...new Set(recipients)].filter(Boolean);
  if (unique.length === 0) return;
  await db.insert(notifications).values(
    unique.map((recipientId) => ({
      recipientId,
      patientId: input.patientId ?? null,
      type: input.type,
      title: input.title,
      message: input.message,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      link: input.link ?? null,
      severity: input.severity ?? 'INFO',
    })),
  );
}

export async function listNotifications(params: {
  userId: string;
  unreadOnly?: boolean;
  limit?: number;
  cursor?: string | null;
}) {
  const limit = Math.min(params.limit ?? 20, 100);
  const conditions = [eq(notifications.recipientId, params.userId)];
  if (params.unreadOnly) conditions.push(eq(notifications.read, false));
  if (params.cursor) conditions.push(lt(notifications.createdAt, new Date(params.cursor)));

  const rows = await db.select().from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.createdAt.toISOString() : null };
}

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), eq(notifications.read, false)));
  return row?.count ?? 0;
}

/** Scoped by recipient — a user can never mark someone else's notification. */
export async function markRead(userId: string, notificationId: string): Promise<boolean> {
  const rows = await db.update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, userId)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function markAllRead(userId: string): Promise<number> {
  const rows = await db.update(notifications)
    .set({ read: true, readAt: new Date() })
    .where(and(eq(notifications.recipientId, userId), eq(notifications.read, false)))
    .returning({ id: notifications.id });
  return rows.length;
}
