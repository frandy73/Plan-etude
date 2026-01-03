import React from 'react';
import StudyPlanner from './components/StudyPlanner';

/**
 * Main application component.
 * Renders the overall layout and the StudyPlanner component.
 */
function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-3 sm:p-6 lg:p-8">
      <div className="max-w-4xl w-full bg-white shadow-xl rounded-xl p-4 sm:p-8 lg:p-10 border border-gray-200">
        <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-4 sm:mb-6 text-center leading-tight">
          Agent Planificateur d'Études Virtuel
        </h1>
        <p className="text-center text-gray-600 mb-6 sm:mb-8 max-w-2xl mx-auto text-sm sm:text-lg">
          Un expert en ingénierie pédagogique pour vous aider à maîtriser n'importe quel sujet.
          Entrez un sujet ci-dessous pour générer un plan d'étude structuré, documenté et réaliste.
        </p>
        <StudyPlanner />
      </div>
    </div>
  );
}

export default App;