import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PatientList } from '@/features/patients/patient-list';
import { LoadingBlock } from '@/components/ui';

export const metadata: Metadata = { title: 'Patients' };
export const dynamic = 'force-dynamic';

export default function PatientsPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <PatientList />
    </Suspense>
  );
}
