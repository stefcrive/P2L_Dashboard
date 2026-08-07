// Common types for IRMS application

export interface DataFile {
  id: string;
  filename: string;
  uploadDate: string;
  size: number;
  status: 'uploaded' | 'processing' | 'processed' | 'error';
  contentType?: string;
  metadata?: DataFileMetadata;
}

export interface DataFileMetadata {
  sampleCount?: number;
  measurementType?: string;
  instrument?: string;
  analysisDate?: string;
  operator?: string;
}

export interface CalibrationProcess {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  currentStep?: string;
  stepsCompleted: number;
  totalSteps: number;
  estimatedTimeRemaining?: string;
  startTime: string;
  endTime?: string;
}

export interface CalibrationResult {
  calibrationId: string;
  accuracy: number;
  precision: number;
  linearity: number;
  referenceStandards: Record<string, StandardResult>;
  recommendations: string[];
}

export interface StandardResult {
  value: number;
  deviation: number;
  unit?: string;
}

export interface Report {
  id: string;
  title: string;
  date: string;
  type: 'summary' | 'client' | 'analysis' | 'calibration';
  status: 'draft' | 'completed' | 'archived';
  samplesAnalyzed?: number;
  data?: ReportData;
}

export interface ReportData {
  summary?: {
    totalSamples: number;
    averageDelta13C?: number;
    averageDelta18O?: number;
    stdDeviation?: number;
  };
  qualityMetrics?: {
    precision: number;
    accuracy: number;
  };
  samples?: SampleData[];
}

export interface SampleData {
  id: string;
  name: string;
  delta13C?: number;
  delta18O?: number;
  analysisDate: string;
  operator?: string;
  notes?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Measurement types
export type MeasurementType =
  | 'delta13C'
  | 'delta18O'
  | 'delta15N'
  | 'delta2H'
  | 'delta34S';

// File processing status
export type ProcessingStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled';

// User roles
export type UserRole = 'admin' | 'analyst' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  lastLogin?: string;
}