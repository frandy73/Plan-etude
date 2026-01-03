import React, { useState, useCallback, useEffect, useRef } from 'react';
import { generateStudyPlan } from '../services/geminiService';
import { StudyPlanResult, GroundingChunkWeb, StudyWeek } from '../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm'; // GitHub Flavored Markdown

// Key for local storage
const LOCAL_STORAGE_KEY = 'virtualStudyPlannerPlan';

/**
 * Custom renderer for links in Markdown to handle citations.
 * It checks if the link is a local citation (e.g., #resource-1) and handles scrolling.
 * Otherwise, it renders a standard external link.
 */
const LinkRenderer: React.FC<any> = ({ href, children }) => {
  if (href && href.startsWith('#resource-')) {
    const handleCitationClick = (e: React.MouseEvent) => {
      e.preventDefault();
      const targetElement = document.getElementById(href.substring(1));
      if (targetElement) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    return (
      <a href={href} onClick={handleCitationClick} className="text-blue-600 hover:underline font-semibold" aria-label={`Aller à la ressource ${href.substring(10)}`}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-words">
      {children}
    </a>
  );
};

/**
 * StudyPlanner component handles user interaction, API calls, and displaying the study plan.
 */
const StudyPlanner: React.FC = () => {
  const [topic, setTopic] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPlanResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  // Ref for the hidden file input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State to track which weeks are collapsed. 
  // Key is week index, value true means collapsed (hidden), false/undefined means expanded.
  const [collapsedWeeks, setCollapsedWeeks] = useState<Record<number, boolean>>({});

  // Effect to load study plan from local storage on component mount
  useEffect(() => {
    try {
      const storedPlan = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedPlan) {
        const parsedPlan: StudyPlanResult = JSON.parse(storedPlan);
        setStudyPlan(parsedPlan);
      }
    } catch (e) {
      console.error("Failed to parse stored study plan from local storage:", e);
      // Clear potentially corrupt data
      localStorage.removeItem(LOCAL_STORAGE_KEY);
      setError("Erreur lors du chargement du plan sauvegardé. Le plan a été effacé.");
    }
  }, []); // Empty dependency array means this runs once on mount

  // Effect to save study plan to local storage whenever it changes
  useEffect(() => {
    if (studyPlan) {
      try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(studyPlan));
      } catch (e) {
        console.error("Failed to save study plan to local storage:", e);
        setError("Erreur lors de la sauvegarde automatique du plan. Veuillez copier votre plan si nécessaire.");
      }
    } else {
      // If studyPlan becomes null (e.g., new search initiated), clear local storage
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, [studyPlan]); // Runs whenever studyPlan state changes


  /**
   * Parses the raw text response from Gemini into structured sections.
   * Uses robust keyword matching on headers to split the content.
   * Also transforms citations in detailedPlan into markdown-compatible links.
   * Extracts calendar data from the detailed plan.
   * @param responseText The raw text output from the Gemini model.
   * @param groundingChunks An array of web grounding chunks (actual links) from the search tool.
   * @returns A `StudyPlanResult` object.
   */
  const parseGeminiResponse = (responseText: string, groundingChunks: GroundingChunkWeb[]): StudyPlanResult => {
    // Normalize newlines
    const normalizedText = responseText.replace(/\r\n/g, '\n');
    
    // Split by '##' headers, handling potential spaces or newlines around them.
    // Using regex to split allows flexibility.
    const rawSections = normalizedText.split(/^##\s+/gm);
    const sections = rawSections.filter(s => s.trim() !== '');

    let summary = 'Résumé non trouvé.';
    let modulesBreakdown = 'Découpage non trouvé.';
    let detailedPlan = 'Plan détaillé non trouvé.';
    let rawDetailedPlanContent = '';
    let quiz = 'Quiz non trouvé.';
    let finalAdvice = 'Conseil non trouvé.';
    const calendarData: StudyWeek[] = [];

    // Iterate through sections to extract content based on title keywords.
    for (const section of sections) {
      const trimmedSection = section.trim();
      if (!trimmedSection) continue;

      // Extract first line as title
      const firstLineEnd = trimmedSection.indexOf('\n');
      let titleLine = '';
      let content = '';

      if (firstLineEnd === -1) {
        titleLine = trimmedSection.toLowerCase();
      } else {
        titleLine = trimmedSection.substring(0, firstLineEnd).toLowerCase();
        content = trimmedSection.substring(firstLineEnd).trim();
      }

      // Check for keywords in the title line
      if (titleLine.includes('résumé') || titleLine.includes('objectif')) {
        summary = content;
      } else if (titleLine.includes('découpage') || (titleLine.includes('modules') && titleLine.includes('compétences'))) {
        modulesBreakdown = content;
      } else if (titleLine.includes('planning') || titleLine.includes('détaillé')) {
        rawDetailedPlanContent = content;
        // Transform citations [1] -> [1](#resource-1)
        detailedPlan = rawDetailedPlanContent.replace(/\[(\d+)\]/g, (match, p1) => {
          const resourceIndex = parseInt(p1, 10);
          return `[${p1}](#resource-${resourceIndex})`;
        });
      } else if (titleLine.includes('quiz') || titleLine.includes('évaluation')) {
        quiz = content;
      } else if (titleLine.includes('conseil') || titleLine.includes('final')) {
        finalAdvice = content;
      }
    }

    // Now, parse calendar data from the rawDetailedPlanContent
    const planLines = rawDetailedPlanContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    let currentWeek: StudyWeek | null = null;

    // Regex Explanation:
    // ^(?:\*\*|__)? : Optional bold start
    // Semaine \d+ : Matches "Semaine 1"
    // (?::|\.)? : Optional colon or dot
    // (?:\*\*|__)? : Optional bold end
    const weekRegex = /^(?:\*\*|__)?Semaine \d+(?:.*)?/i; 
    const dayRegex = /^(?:\*\*|__)?Jour \d+(?:.*)?/i;

    for (const line of planLines) {
      if (weekRegex.test(line)) {
        // New week starts
        if (currentWeek) {
          calendarData.push(currentWeek);
        }
        // Remove bolding markers for clean display
        const cleanWeekTitle = line.replace(/[\*\_]/g, ''); 
        currentWeek = { week: cleanWeekTitle, days: [] };
      } else if (currentWeek && dayRegex.test(line)) {
        // Day task
        // Split by the first colon to separate "Jour X" from the task
        const separatorIndex = line.indexOf(':');
        
        let day = '';
        let task = '';

        if (separatorIndex !== -1) {
             day = line.substring(0, separatorIndex).replace(/[\*\_]/g, '').trim();
             task = line.substring(separatorIndex + 1).trim();
        } else {
            // Fallback if no colon
            const words = line.split(' ');
            day = words.slice(0, 2).join(' ').replace(/[\*\_]/g, ''); // "Jour 1"
            task = words.slice(2).join(' ');
        }
        
        currentWeek.days.push({ day, task, completed: false });
      }
    }
    if (currentWeek) {
      calendarData.push(currentWeek);
    }

    return {
      summary,
      modulesBreakdown,
      detailedPlan,
      calendarData,
      resources: groundingChunks,
      quiz,
      finalAdvice,
      rawResponse: responseText,
    };
  };

  /**
   * Helper to convert a File to a Base64 string (without the data URL prefix).
   */
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove "data:application/pdf;base64," prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  /**
   * Handles file selection from the input.
   */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type !== 'application/pdf') {
        setError('Veuillez sélectionner un fichier PDF.');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  /**
   * Clears the selected file.
   */
  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Handles the submission of the study topic and/or file.
   * Initiates the API call and manages loading/error states.
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() && !selectedFile) {
      setError("Veuillez entrer un sujet d'étude ou télécharger un document PDF.");
      return;
    }

    setLoading(true);
    setError(null);
    setStudyPlan(null); // Clear previous results
    setCollapsedWeeks({}); // Reset collapsed state

    try {
      let fileData = undefined;
      if (selectedFile) {
        const base64 = await fileToBase64(selectedFile);
        fileData = {
          data: base64,
          mimeType: selectedFile.type
        };
      }

      const { text, groundingChunks } = await generateStudyPlan(topic, fileData);
      const parsedPlan = parseGeminiResponse(text, groundingChunks);
      setStudyPlan(parsedPlan);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue lors de la génération du plan.");
      console.error("Study plan generation error:", err);
    } finally {
      setLoading(false);
    }
  }, [topic, selectedFile]);

  /**
   * Resets the state to start a new request.
   */
  const handleReset = useCallback(() => {
    setTopic('');
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setStudyPlan(null);
    setError(null);
    setCollapsedWeeks({});
    // Scroll to top to ensure the user sees the input
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  /**
   * Toggles the completion status of a specific task in the calendar view.
   * @param weekIndex The index of the week.
   * @param dayIndex The index of the day within the week.
   */
  const handleToggleTaskCompletion = useCallback((weekIndex: number, dayIndex: number) => {
    if (!studyPlan) return;

    const updatedCalendarData = studyPlan.calendarData.map((week, wIdx) => {
      if (wIdx === weekIndex) {
        return {
          ...week,
          days: week.days.map((day, dIdx) => {
            if (dIdx === dayIndex) {
              return { ...day, completed: !day.completed };
            }
            return day;
          }),
        };
      }
      return week;
    });

    setStudyPlan({ ...studyPlan, calendarData: updatedCalendarData });
  }, [studyPlan]);

  /**
   * Toggles the collapsed state of a week card.
   * @param weekIndex The index of the week to toggle.
   */
  const toggleWeek = (weekIndex: number) => {
    setCollapsedWeeks(prev => ({
      ...prev,
      [weekIndex]: !prev[weekIndex]
    }));
  };

  /**
   * Formats the study plan into a plain text string for export.
   */
  const formatPlanAsText = useCallback((plan: StudyPlanResult): string => {
    let text = `Plan d'Étude: ${topic || (selectedFile ? selectedFile.name : 'Document')}\n\n`;

    text += `🎯 Résumé de l’objectif d’apprentissage\n${plan.summary}\n\n`;
    text += `🧩 Découpage des modules / compétences\n${plan.modulesBreakdown}\n\n`;
    text += `📅 Planning détaillé\n`;
    plan.calendarData.forEach(weekData => {
      text += `${weekData.week}\n`;
      weekData.days.forEach(dayData => {
        text += `  ${dayData.day}: ${dayData.task} [${dayData.completed ? 'COMPLÉTÉ' : 'À FAIRE'}]\n`;
      });
    });
    text += `\n`;

    text += `📚 Ressources recommandées\n`;
    if (plan.resources.length > 0) {
      plan.resources.forEach((res, index) => {
        text += `${index + 1}. ${res.web.title || `Ressource ${index + 1}`}\n   ${res.web.uri}\n`;
      });
    } else {
      text += `Aucune ressource spécifique n'a été trouvée ou citée.\n`;
    }
    text += `\n`;

    text += `📝 Mini quiz d’évaluation\n${plan.quiz}\n\n`;
    text += `🚀 Conseil pédagogique final\n${plan.finalAdvice}\n`;

    return text;
  }, [topic, selectedFile]);

  /**
   * Handles exporting the study plan as a text file.
   */
  const handleExportText = useCallback(() => {
    if (!studyPlan) return;
    const cleanName = (topic || selectedFile?.name || 'etude').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `plan-etude-${cleanName}.txt`;
    const textContent = formatPlanAsText(studyPlan);
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [studyPlan, topic, selectedFile, formatPlanAsText]);

  /**
   * Handles exporting the study plan as a PDF (via browser print dialog).
   */
  const handleExportPdf = useCallback(() => {
    if (!studyPlan) return;
    // Trigger browser print dialog
    window.print();
  }, [studyPlan]);

  // Calculate progress statistics
  const calculateProgress = () => {
    if (!studyPlan || studyPlan.calendarData.length === 0) return 0;
    
    let totalTasks = 0;
    let completedTasks = 0;

    studyPlan.calendarData.forEach(week => {
      week.days.forEach(day => {
        totalTasks++;
        if (day.completed) completedTasks++;
      });
    });

    return totalTasks === 0 ? 0 : Math.round((completedTasks / totalTasks) * 100);
  };

  const progressPercentage = calculateProgress();

  return (
    <div className="flex flex-col space-y-8">
      {/* Input Form Section */}
      <form onSubmit={handleSubmit} className="flex flex-col space-y-5">
        <label htmlFor="topic" className="text-gray-800 font-bold text-lg sm:text-2xl">
          Quel sujet ou document souhaitez-vous maîtriser ?
        </label>
        
        <textarea
          id="topic"
          className="w-full p-3 sm:p-4 border border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 transition duration-200 ease-in-out resize-y min-h-[100px] text-sm sm:text-base"
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Entrez un sujet (ex: Histoire de Rome) ou ajoutez un commentaire pour accompagner votre fichier PDF..."
          disabled={loading}
          aria-label="Sujet d'étude"
        />

        {/* File Upload Section */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-3 sm:space-y-0 sm:space-x-4">
            <input
                type="file"
                accept=".pdf"
                ref={fileInputRef}
                onChange={handleFileChange}
                className="hidden"
                id="pdf-upload"
                disabled={loading}
            />
            <label
                htmlFor="pdf-upload"
                className={`cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                </svg>
                Joindre un PDF (Cours, Syllabus...)
            </label>

            {selectedFile && (
                <div className="flex items-center bg-blue-50 text-blue-700 px-3 py-2 rounded-md border border-blue-200">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-xs" title={selectedFile.name}>
                        {selectedFile.name}
                    </span>
                    <button
                        type="button"
                        onClick={clearFile}
                        className="ml-2 text-blue-400 hover:text-blue-600 focus:outline-none"
                        title="Supprimer le fichier"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
            )}
        </div>

        <button
          type="submit"
          className={`w-full sm:w-auto px-6 sm:px-8 py-3 rounded-lg text-white font-semibold text-base sm:text-lg shadow-md transition-all duration-300 ease-in-out
            ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-300 active:bg-blue-800'}`}
          disabled={loading}
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Génération...
            </span>
          ) : (
            'Générer le plan d\'étude'
          )}
        </button>

        {/* Action Buttons (Visible only if plan exists) */}
        {studyPlan && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 export-buttons-container">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 shadow-sm text-sm sm:text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              🔄 Nouvelle recherche
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="flex items-center justify-center px-4 py-3 border border-transparent shadow-sm text-sm sm:text-base font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              📄 Télécharger PDF
            </button>
            <button
              type="button"
              onClick={handleExportText}
              className="flex items-center justify-center px-4 py-3 border border-gray-300 shadow-sm text-sm sm:text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              💾 Exporter Texte
            </button>
          </div>
        )}
      </form>

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-5 py-4 rounded-lg relative shadow-md" role="alert">
          <strong className="font-bold text-xl">Oops!</strong>
          <span className="block sm:inline ml-2">{error}</span>
          <p className="text-sm mt-2">Veuillez réessayer ou vérifier votre sujet/fichier.</p>
        </div>
      )}

      {/* Study Plan Results Display */}
      {studyPlan && (
        <div className="mt-6 sm:mt-8 p-4 sm:p-6 bg-gray-50 rounded-lg shadow-inner border border-gray-200 animate-fade-in transition-opacity duration-500">
          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 border-b-2 pb-3 border-blue-200">
            Votre Plan d'Étude Personnalisé
          </h2>

          <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-blue-50 border-l-4 border-blue-300 rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-blue-800 mb-3 flex items-center">
              <span className="mr-2">🎯</span>Résumé de l'objectif
            </h3>
            <div className="text-gray-800 leading-relaxed text-sm sm:text-lg markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {studyPlan.summary}
              </ReactMarkdown>
            </div>
          </div>

          {/* New section: Module Breakdown */}
          <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-purple-50 border-l-4 border-purple-300 rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-purple-800 mb-3 flex items-center">
              <span className="mr-2">🧩</span>Découpage des modules
            </h3>
            <div className="text-gray-800 leading-relaxed text-sm sm:text-lg markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {studyPlan.modulesBreakdown}
              </ReactMarkdown>
            </div>
          </div>

          <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-white border rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-gray-800 mb-3 flex items-center">
              <span className="mr-2">📅</span>Planning détaillé
            </h3>
            <div className="text-gray-800 leading-relaxed text-sm sm:text-lg markdown-content break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: LinkRenderer }}>
                {studyPlan.detailedPlan}
              </ReactMarkdown>
            </div>
          </div>

          {/* New Calendar View Section with Progress Bar and Collapsible Weeks */}
          {studyPlan.calendarData.length > 0 && (
            <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-indigo-50 border-l-4 border-indigo-300 rounded-md shadow-sm">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-3 sm:gap-0">
                <h3 className="text-lg sm:text-2xl font-semibold text-indigo-800">Vue Calendrier</h3>
                {/* Progress Bar Container */}
                <div className="w-full sm:w-1/2 flex items-center">
                  <div className="w-full bg-gray-200 rounded-full h-4 mr-3">
                    <div 
                      className="bg-green-500 h-4 rounded-full transition-all duration-500 ease-out" 
                      style={{ width: `${progressPercentage}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-bold text-indigo-700 whitespace-nowrap">{progressPercentage}% complété</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {studyPlan.calendarData.map((weekData, weekIndex) => (
                  <div key={weekIndex} className="bg-white rounded-lg shadow-md border border-indigo-200 overflow-hidden">
                    {/* Collapsible Header */}
                    <div 
                      className="p-4 bg-indigo-50 cursor-pointer flex justify-between items-center select-none hover:bg-indigo-100 transition-colors"
                      onClick={() => toggleWeek(weekIndex)}
                      aria-expanded={!collapsedWeeks[weekIndex]}
                    >
                      <h4 className="font-bold text-base sm:text-xl text-indigo-700 flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6 mr-2 text-indigo-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <span className="break-words">{weekData.week}</span>
                      </h4>
                      {/* Chevron Icon */}
                      <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        className={`h-5 w-5 text-indigo-500 transition-transform duration-300 flex-shrink-0 ml-2 ${collapsedWeeks[weekIndex] ? 'transform -rotate-90' : 'transform rotate-0'}`} 
                        fill="none" 
                        viewBox="0 0 24 24" 
                        stroke="currentColor" 
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Task List - Conditional Rendering for Accordion Effect */}
                    <div className={`transition-all duration-300 ease-in-out ${collapsedWeeks[weekIndex] ? 'max-h-0 opacity-0' : 'max-h-[1000px] opacity-100'} overflow-hidden`}>
                      <ul className="list-none space-y-2 p-4 pt-0 border-t border-gray-100">
                        {weekData.days.map((dayData, dayIndex) => (
                          <li
                            key={dayIndex}
                            className={`flex items-start p-2 rounded-md transition-all duration-200 mt-2
                              ${dayData.completed ? 'bg-green-50 text-gray-500 line-through border-l-4 border-green-500' : 'hover:bg-gray-50'} text-sm sm:text-base`
                            }
                          >
                            <input
                              type="checkbox"
                              className="form-checkbox h-5 w-5 text-green-600 rounded border-gray-300 focus:ring-green-500 mt-1 mr-3 flex-shrink-0 cursor-pointer"
                              checked={dayData.completed}
                              onChange={() => handleToggleTaskCompletion(weekIndex, dayIndex)}
                              aria-label={dayData.completed ? `Démarquer la tâche du ${dayData.day} comme non complétée` : `Marquer la tâche du ${dayData.day} comme complétée`}
                            />
                            <span className="flex-1 text-gray-800 break-words">
                              <span className="font-semibold text-indigo-600 mr-1">{dayData.day}:</span>
                              {dayData.task}
                            </span>
                            {dayData.completed && (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600 ml-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-green-50 border-l-4 border-green-300 rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-green-800 mb-3 flex items-center">
              <span className="mr-2">📚</span>Ressources recommandées
            </h3>
            {studyPlan.resources.length > 0 ? (
              <ul className="list-none text-blue-700 space-y-4 text-sm sm:text-base">
                {studyPlan.resources.map((res, index) => (
                  <li key={index} id={`resource-${index + 1}`} className="flex items-start bg-white p-3 rounded-md shadow-sm border border-green-200">
                    <span className="mr-3 text-green-600 font-bold text-base sm:text-lg">{index + 1}.</span>
                    <div className="flex-1 min-w-0"> {/* min-w-0 crucial for flex child truncation/breaking */}
                      <a href={res.web.uri} target="_blank" rel="noopener noreferrer" className="hover:underline text-blue-600 visited:text-purple-600 block" aria-label={`Aller à la ressource ${res.web.title || `Lien ${index + 1}`}`}>
                        <span className="font-bold text-gray-900 block break-words">{res.web.title || `Ressource ${index + 1}`}</span>
                        <span className="text-sm text-gray-700 break-all">{res.web.uri}</span>
                      </a>
                    </div>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-2 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-600 text-sm sm:text-base">Aucune ressource spécifique n'a été trouvée ou citée par la recherche Google.</p>
            )}
          </div>

          <div className="mb-6 sm:mb-8 p-4 sm:p-5 bg-yellow-50 border-l-4 border-yellow-300 rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-yellow-800 mb-3 flex items-center">
              <span className="mr-2">📝</span>Mini quiz d’évaluation
            </h3>
            <div className="text-gray-800 leading-relaxed text-sm sm:text-lg markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {studyPlan.quiz}
              </ReactMarkdown>
            </div>
          </div>

          {/* New section: Final Pedagogical Advice */}
          <div className="p-4 sm:p-5 bg-red-50 border-l-4 border-red-300 rounded-md shadow-sm">
            <h3 className="text-lg sm:text-2xl font-semibold text-red-800 mb-3 flex items-center">
              <span className="mr-2">🚀</span>Conseil pédagogique final
            </h3>
            <div className="text-gray-800 leading-relaxed text-sm sm:text-lg markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {studyPlan.finalAdvice}
              </ReactMarkdown>
            </div>
          </div>

          {/* Bottom Reset Button */}
          <div className="mt-8 text-center export-buttons-container">
            <button
              onClick={handleReset}
              className="px-6 py-3 border border-gray-300 shadow-sm text-base font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors inline-flex items-center"
            >
              <span className="mr-2">🔄</span> Effectuer une autre recherche
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudyPlanner;