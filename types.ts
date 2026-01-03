/**
 * Represents a web grounding chunk from the Google Search tool.
 */
export interface GroundingChunkWeb {
  web: {
    uri: string;
    title: string;
  };
}

/**
 * Represents a single day's task within a study week.
 */
export interface StudyDay {
  day: string; // e.g., "Jour 1", "Day 2"
  task: string; // e.g., "Introduction aux variables [1]"
  completed: boolean; // New field for task tracking
}

/**
 * Represents a week in the study plan, containing multiple days/tasks.
 */
export interface StudyWeek {
  week: string; // e.g., "Semaine 1", "Week 2"
  days: StudyDay[];
}

/**
 * Represents the structured result of a generated study plan.
 */
export interface StudyPlanResult {
  summary: string;
  modulesBreakdown: string; // New field for module breakdown
  detailedPlan: string;
  calendarData: StudyWeek[]; // New field for structured calendar view
  resources: GroundingChunkWeb[]; // Actual links extracted from grounding chunks
  quiz: string;
  finalAdvice: string; // New field for final pedagogical advice
  rawResponse: string; // The full raw text response from Gemini for debugging/inspection
}

/**
 * Represents the raw response structure from the Gemini service.
 */
export interface GeminiServiceResponse {
  text: string;
  groundingChunks: GroundingChunkWeb[];
}