import { AppointmentRepository } from '../db/appointmentRepository';
import { VisitStatus } from '../domain/status';
export class AppointmentService {
  list() { return new AppointmentRepository().list(); }
  status = VisitStatus.Scheduled;
}
