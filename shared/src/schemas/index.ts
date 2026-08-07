import { z } from 'zod';

// Data file validation schemas
export const DataFileSchema = z.object({
  id: z.string(),
  filename: z.string(),
  uploadDate: z.string(),
  size: z.number().positive(),
  status: z.enum(['uploaded', 'processing', 'processed', 'error']),
  contentType: z.string().optional(),
  metadata: z.object({
    sampleCount: z.number().optional(),
    measurementType: z.string().optional(),
    instrument: z.string().optional(),
    analysisDate: z.string().optional(),
    operator: z.string().optional(),
  }).optional(),
});

// File upload validation
export const FileUploadSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  size: z.number().positive('File size must be positive'),
  contentType: z.string().min(1, 'Content type is required'),
});

// Calibration process validation
export const CalibrationProcessSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  progress: z.number().min(0).max(100),
  currentStep: z.string().optional(),
  stepsCompleted: z.number().min(0),
  totalSteps: z.number().positive(),
  estimatedTimeRemaining: z.string().optional(),
  startTime: z.string(),
  endTime: z.string().optional(),
});

// Report validation
export const ReportSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Title is required'),
  date: z.string(),
  type: z.enum(['summary', 'client', 'analysis', 'calibration']),
  status: z.enum(['draft', 'completed', 'archived']),
  samplesAnalyzed: z.number().optional(),
});

// Sample data validation
export const SampleDataSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Sample name is required'),
  delta13C: z.number().optional(),
  delta18O: z.number().optional(),
  analysisDate: z.string(),
  operator: z.string().optional(),
  notes: z.string().optional(),
});

// User validation
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email('Invalid email format'),
  name: z.string().min(1, 'Name is required'),
  role: z.enum(['admin', 'analyst', 'viewer']),
  isActive: z.boolean(),
  createdAt: z.string(),
  lastLogin: z.string().optional(),
});

// API request/response validation
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export const PaginationSchema = z.object({
  page: z.number().min(1),
  pageSize: z.number().min(1).max(100),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// Export type inference
export type DataFileInput = z.infer<typeof DataFileSchema>;
export type FileUploadInput = z.infer<typeof FileUploadSchema>;
export type CalibrationProcessInput = z.infer<typeof CalibrationProcessSchema>;
export type ReportInput = z.infer<typeof ReportSchema>;
export type SampleDataInput = z.infer<typeof SampleDataSchema>;
export type UserInput = z.infer<typeof UserSchema>;
export type ApiResponseInput = z.infer<typeof ApiResponseSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;