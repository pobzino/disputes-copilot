export type Action = "represent" | "accept_liability" | "request_more_evidence";
export type Status = "satisfied" | "partial" | "missing";
export type Confidence = "high" | "medium" | "low";

export interface CaseSummary {
  case_id: string;
  scheme: string;
  reason_code: string;
  reason_code_label?: string;
  merchant_name?: string;
  amount?: number;
  currency?: string;
  documents: string[];
  analysed: boolean;
  recommended_action: Action | null;
  confidence: Confidence | null;
  flags: number;
  decision: { analyst_action: string; analyst_rationale: string; status: string } | null;
}

export interface RequirementAssessment {
  requirement: string;
  status: Status;
  source_document?: string | null;
  source_location?: string | null;
  supporting_quote?: string | null;
  reasoning: string;
  confidence: Confidence;
  analyst_checks?: string[];
  merchant_request?: string | null;
}

export interface Workup {
  reason_code_summary: string;
  evidence_assessment: RequirementAssessment[];
  representment_rationale: string;
  recommended_action: Action;
  action_justification: string;
  evidence_requests: string[];
  overall_confidence: Confidence;
  flags: string[];
}

export interface ExtractedFact {
  fact: string;
  location: string;
  verbatim_quote?: string | null;
}

export interface DocumentExtraction {
  filename: string;
  document_type: string;
  summary: string;
  facts: ExtractedFact[];
  quality_notes?: string | null;
  error?: string | null;
}

export interface CaseResult {
  case_id: string;
  workup: Workup;
  extractions: DocumentExtraction[];
  model: string;
  generated_at: string;
}

export interface RowReview {
  verdict: "verified" | "wrong" | null;
  comment: string;
  corrected_status?: Status | null;
}

export interface CaseDetail {
  case: {
    case_id: string;
    scheme: string;
    reason_code: string;
    reason_code_label?: string;
    merchant_name?: string;
    amount?: number;
    currency?: string;
    issuer_narrative: string;
    transaction_metadata: Record<string, unknown>;
    evidence_documents: { filename: string; description?: string }[];
  };
  result: CaseResult | null;
  decision: { analyst_action: Action; analyst_rationale: string } | null;
  row_reviews: Record<string, RowReview>;
}
