import type { Metadata } from 'next';
import { MessageList } from '@/features/messaging/message-list';

export const metadata: Metadata = { title: 'Messages' };
export const dynamic = 'force-dynamic';

export default function MessagesPage() {
  return <MessageList />;
}
