export type User = {
  id: string;
  fullName: string;
  email: string;
  role: "admin" | "voter" | "candidate" | "auditor" | "party";
  isApproved: boolean;
};

export type Voter = User & { createdAt: string };

export type Election = {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  status: "upcoming" | "active" | "ended";
  candidateCount: number;
  partyCount: number;
  serverTime: string;
  bannerVersion: string | null;
  removedAt: string | null;
};
export type Nominee = { id: string; fullName: string; biography: string; roleName: string; rank: number };
export type CandidateRole = { id: string; partyId: string; name: string; rank: number };
export type RegisteredCandidate = Nominee & { partyId: string; roleId: string };
export type Party = { id: string; name: string; manifesto: string; shortName: string; symbol: string; symbolImage?: string | null; roster?: Nominee[] };
export type RegisteredParty = Party & { candidates: RegisteredCandidate[]; roles: CandidateRole[]; accountEmail: string; submittedAt: string | null };
export type RegistryData = { parties: RegisteredParty[]; roles: CandidateRole[]; candidates: RegisteredCandidate[] };
export type Candidate = RegisteredCandidate;
export type AssignedVoter = Pick<User, "id" | "fullName" | "email" | "isApproved">;
export type ElectionDetail = { election: Election; candidates: Party[]; parties: Party[]; voters?: AssignedVoter[] };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError("Unable to reach SecureVote. Check your connection and try again.", 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new ApiError(data?.message ?? "The service is unavailable. Please try again.", response.status);
  }
  return data as T;
}
