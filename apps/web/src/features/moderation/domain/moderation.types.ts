export interface ReviewDecision {
  id: string;
  decision: "APPROVE" | "REJECT";
  version: number;
  reason?: string;
}

export interface AdminPendingOrganizer {
  id: string;
  organizationName: string;
  representativeName: string;
  taxCode: string;
  businessLicenseUrl: string | null;
  status: "PENDING_VERIFICATION";
  version: number;
  createdAt: string;
  email: string;
}

export interface AdminPendingEvent {
  id: string;
  title: string;
  bannerUrl?: string | null;
  organizationName: string;
  status: "PENDING_APPROVAL";
  version: number;
  startTime: string;
  createdAt: string;
}
