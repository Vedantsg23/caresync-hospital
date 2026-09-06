import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PatientProfile } from '@/features/patients/patient-profile';
import { LoadingBlock } from '@/components/ui';

export const metadata: Metadata = { title: 'Patient record' };
export const dynamic = 'force-dynamic';

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <PatientProfile patientId={id} />
    </Suspense>
  );
}
