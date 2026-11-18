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
  eta_end_of_cursus: string;
  end_of_cursus_max_deadline?: string | null;
  milestones: PaceMilestone[];
}

export const V2_ORIGIN = 'https://profile.intra.42.fr';
export const V3_ORIGIN = 'https://profile-v3.intra.42.fr';

export type PaceMessage =
  | { type: 'ir-pace-request'; userId: string }
  | { type: 'ir-pace-response'; data?: PaceProfile; error?: string };
