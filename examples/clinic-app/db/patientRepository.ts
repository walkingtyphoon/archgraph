import { Connection } from './connection';
import type { Patient } from '../domain/patient';
export class PatientRepository {
  constructor(readonly connection = new Connection()) {}
  list(): Patient[] { return [{ id: 'p1', name: 'Ada' }]; }
}
