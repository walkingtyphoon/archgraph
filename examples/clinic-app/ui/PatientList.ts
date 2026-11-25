import { PatientService } from '../service/patientService';
import { PatientRepository } from '../db/patientRepository'; // Deliberate architecture violation.
export function patientList() { return { patients: new PatientService().list(), bypass: new PatientRepository().list() }; }
