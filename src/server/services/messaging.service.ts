import '@/server/only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/server/db/client';
import {
  conversations, conversationParticipants, messages, users, patients, staffProfiles, departments,
} from '@/server/db/schema';
import { AppError } from '@/server/core/errors';
import { assertPatientAccess } from './patient-access.service';
import { notifyMany } from './notification.service';
import { recordAudit, AUDIT } from '@/server/core/audit';
import type { AuthUser } from '@/server/auth/context';

/**
 * Internal, directed clinical communication. Not a social feed:
 *  - every conversation has an explicit participant list;
 *  - a conversation attached to a patient requires patient access from
 *    everyone who is added to it.
 */
async function assertParticipant(userId: string, conversationId: string) {
  const [row] = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, userId),
    ))
    .limit(1);
  if (!row) throw new AppError('FORBIDDEN', 'You are not a participant in this conversation.');
}

export async function listConversations(user: AuthUser) {
  return db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      patientId: patients.id,
      patientName: sql<string | null>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
      participantCount: sql<number>`(SELECT count(*)::int FROM ${conversationParticipants} cp WHERE cp.conversation_id = conversations.id)`,
      messageCount: sql<number>`(SELECT count(*)::int FROM ${messages} m WHERE m.conversation_id = conversations.id)`,
      unreadCount: sql<number>`(
        SELECT count(*)::int FROM ${messages} m
        WHERE m.conversation_id = ${conversations.id}
          AND m.sender_id <> ${user.id}
          AND (${conversationParticipants.lastReadAt} IS NULL OR m.created_at > ${conversationParticipants.lastReadAt}))`,
      lastMessage: sql<string | null>`(SELECT m.body FROM ${messages} m WHERE m.conversation_id = conversations.id ORDER BY m.created_at DESC LIMIT 1)`,
    })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .leftJoin(patients, eq(patients.id, conversations.patientId))
    .where(eq(conversationParticipants.userId, user.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);
}

export async function createConversation(
  user: AuthUser,
  input: { subject: string; participantIds: string[]; patientId?: string; firstMessage?: string },
) {
  const participants = [...new Set([user.id, ...input.participantIds])];
  if (participants.length < 2) {
    throw new AppError('VALIDATION_ERROR', 'Select at least one other member of staff.');
  }

  if (input.patientId) await assertPatientAccess(user, input.patientId);

  const valid = await db.select({ id: users.id }).from(users)
    .where(and(inArray(users.id, participants), eq(users.isActive, true)));
  if (valid.length !== participants.length) {
    throw new AppError('VALIDATION_ERROR', 'One or more selected staff members are not available.');
  }

  const conversation = await db.transaction(async (tx) => {
    const [conv] = await tx.insert(conversations).values({
      subject: input.subject,
      patientId: input.patientId ?? null,
      createdById: user.id,
    }).returning();

    await tx.insert(conversationParticipants).values(
      participants.map((userId) => ({ conversationId: conv!.id, userId })),
    );

    if (input.firstMessage?.trim()) {
      await tx.insert(messages).values({
        conversationId: conv!.id,
        senderId: user.id,
        body: input.firstMessage.trim(),
      });
    }

    return conv!;
  });

  if (input.firstMessage?.trim()) {
    await notifyMany(participants.filter((p) => p !== user.id), {
      patientId: input.patientId ?? null,
      type: 'MESSAGE_RECEIVED',
      title: `New message from ${user.fullName}`,
      message: `${input.subject}: ${input.firstMessage.slice(0, 140)}`,
      referenceType: 'conversation',
      referenceId: conversation.id,
      link: `/messages/${conversation.id}`,
    });
  }

  await recordAudit({
    action: AUDIT.MESSAGE_SENT,
    entityType: 'conversation',
    entityId: conversation.id,
    patientId: input.patientId ?? null,
    actor: user,
    metadata: { participants: participants.length },
  });

  return conversation;
}

export async function getConversation(user: AuthUser, conversationId: string) {
  await assertParticipant(user.id, conversationId);

  const [conversation] = await db
    .select({
      id: conversations.id,
      subject: conversations.subject,
      createdAt: conversations.createdAt,
      patientId: patients.id,
      patientName: sql<string | null>`${patients.firstName} || ' ' || ${patients.lastName}`,
      patientNumber: patients.patientNumber,
    })
    .from(conversations)
    .leftJoin(patients, eq(patients.id, conversations.patientId))
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conversation) throw new AppError('NOT_FOUND', 'Conversation could not be found.');

  const participants = await db
    .select({
      userId: users.id,
      name: users.fullName,
      role: users.primaryRole,
      designation: staffProfiles.designation,
      departmentName: departments.name,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(users.id, conversationParticipants.userId))
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(eq(conversationParticipants.conversationId, conversationId));

  const thread = await db
    .select({
      id: messages.id,
      body: messages.body,
      createdAt: messages.createdAt,
      senderId: users.id,
      senderName: users.fullName,
      senderRole: users.primaryRole,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);

  await db.update(conversationParticipants)
    .set({ lastReadAt: new Date() })
    .where(and(
      eq(conversationParticipants.conversationId, conversationId),
      eq(conversationParticipants.userId, user.id),
    ));

  return { ...conversation, participants, messages: thread };
}

export async function sendMessage(user: AuthUser, conversationId: string, body: string) {
  await assertParticipant(user.id, conversationId);

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) throw new AppError('NOT_FOUND', 'Conversation could not be found.');

  const now = new Date();
  const [message] = await db.transaction(async (tx) => {
    const created = await tx.insert(messages).values({
      conversationId, senderId: user.id, body,
    }).returning();
    await tx.update(conversations).set({ lastMessageAt: now }).where(eq(conversations.id, conversationId));
    return created;
  });

  const others = await db.select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));

  await notifyMany(others.map((o) => o.userId).filter((id) => id !== user.id), {
    patientId: conversation.patientId,
    type: 'MESSAGE_RECEIVED',
    title: `${user.fullName} in "${conversation.subject}"`,
    message: body.slice(0, 160),
    referenceType: 'conversation',
    referenceId: conversationId,
    link: `/messages/${conversationId}`,
  });

  await recordAudit({
    action: AUDIT.MESSAGE_SENT,
    entityType: 'message',
    entityId: message!.id,
    patientId: conversation.patientId,
    actor: user,
  });

  return message!;
}

/** Staff directory for the recipient picker. */
export async function listStaffDirectory(excludeUserId?: string) {
  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      role: users.primaryRole,
      designation: staffProfiles.designation,
      specialization: staffProfiles.specialization,
      departmentName: departments.name,
    })
    .from(users)
    .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
    .leftJoin(departments, eq(departments.id, staffProfiles.departmentId))
    .where(eq(users.isActive, true))
    .orderBy(users.fullName);
  return excludeUserId ? rows.filter((r) => r.id !== excludeUserId) : rows;
}
