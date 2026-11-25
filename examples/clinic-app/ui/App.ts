import { patientList } from './PatientList';
import { PatientCard } from './PatientCard';
import type { Patient } from '../domain';
export function app(patient: Patient) { return { list: patientList(), card: PatientCard({patient}) }; }
