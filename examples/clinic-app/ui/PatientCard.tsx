import type { Patient as PatientRecord } from '../domain/patient.ts';
export type PatientCardProps = { patient: PatientRecord };
export function PatientCard({ patient }: PatientCardProps) { return patient.name; }
