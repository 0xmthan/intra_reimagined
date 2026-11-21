// Shape of pace-system.42.fr/api/v1/users/:id/profile (only the fields we use).

export interface PaceMilestone {
  level: number;
  deadline: string; // YYYY-MM-DD
  validated_at: string | null;
}

export interface PaceProfile {
  milestone: number;
  deadline: string;
  cursus_begin_date: string;
  eta_end_of_cursus: string | null; // null once the common core is validated
  end_of_cursus_max_deadline?: string | null;
  milestones: PaceMilestone[];
  /** Months the student chose to finish the common core in (one of PACES). */
  pace?: number | null;
}

/** The paces 42 offers, fastest first (months for the common core). */
export const PACES = [8, 12, 15, 18, 22, 24];

export const V2_ORIGIN = 'https://profile.intra.42.fr';
export const V3_ORIGIN = 'https://profile-v3.intra.42.fr';

export type PaceMessage =
  | { type: 'ir-pace-request'; userId: string }
  | { type: 'ir-pace-response'; data?: PaceProfile; error?: string };
