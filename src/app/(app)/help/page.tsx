import type { Metadata } from 'next';
import { HelpGuide } from '@/features/help/help-guide';

export const metadata: Metadata = { title: 'Help & Support' };

export default function HelpPage() {
  return <HelpGuide />;
}
