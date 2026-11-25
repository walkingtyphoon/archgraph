import { PatientRepository } from '../db/patientRepository';
import type { Patient } from '../domain/patient';
export class PatientService { list(): Patient[] { return new PatientRepository().list(); } }
