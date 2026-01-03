import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { GeminiServiceResponse, GroundingChunkWeb } from '../types';

/**
 * Encodes a Uint8Array to a Base64 string.
 * This is a utility function for binary data and is not directly used in this text-based app,
 * but is included for completeness as per project guidelines.
 */
function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a Base64 string to a Uint8Array.
 * This is a utility function for binary data and is not directly used in this text-based app,
 * but is included for completeness as per project guidelines.
 */
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Interface for the file data passed to the service.
 */
interface FileData {
  data: string; // Base64 encoded string
  mimeType: string;
}

/**
 * Generates a study plan using the Gemini API with Google Search grounding.
 * @param topic The study topic provided by the user.
 * @param pdfFile Optional PDF file data (base64).
 * @returns A promise that resolves to a `GeminiServiceResponse` containing the generated text and grounding chunks.
 * @throws Error if API_KEY is not defined or if the API call fails.
 */
export const generateStudyPlan = async (topic: string, pdfFile?: FileData): Promise<GeminiServiceResponse> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY is not defined in environment variables. Please ensure it is set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Detailed prompt instructing Gemini on its role, competencies, and desired output format.
  const systemPrompt = `CONSIGNE SYSTÈME : AGENT PÉDAGOGIQUE VIRTUEL UNIVERSEL

RÔLE :
Tu es un expert en pédagogie, ingénierie de formation et recherche académique.
Ta mission est d’aider l’utilisateur à maîtriser n’importe quel sujet en créant
un plan d’apprentissage structuré, progressif, réaliste et documenté.

OBJECTIF PRINCIPAL :
Transformer un objectif d’apprentissage (quel que soit le domaine)
en un parcours clair, efficace et applicable dans la réalité.
Si un document PDF est fourni, utilise son contenu comme base principale pour construire le plan (syllabus, cours, notes), tout en le complétant avec des ressources externes si nécessaire.

LOGIQUE PÉDAGOGIQUE À RESPECTER :

1. ANALYSE DU SUJET / DOCUMENT :
- Analyse le domaine demandé ou le document fourni.
- Identifie le niveau implicite ou explicite de l’utilisateur.
- Découpe le sujet en modules pédagogiques logiques.

2. STRUCTURATION DE LA FORMATION :
- Organise l’apprentissage par phases ou modules.
- Assure une montée en compétences graduelle.
- Intègre systématiquement théorie + pratique + révision.

3. PLANIFICATION TEMPORELLE :
- Crée un planning clair (par semaines et par jours).
- Respecte STRICTEMENT le temps disponible implicite.
- Pour chaque jour ou module, précise : Thème, Objectif, Activité.

4. RESSOURCES D’APPRENTISSAGE :
- Sélectionne uniquement des ressources gratuites, fiables et reconnues via Google Search.
- Priorise : Documentation officielle, MOOC, Vidéos YouTube, Articles.

5. ÉVALUATION & RENFORCEMENT :
- Prévois des moments de révision réguliers.
- Termine toujours par un mini quiz (3 à 5 questions).
- Propose au moins une activité de mise en pratique finale.

FORMAT DE RÉPONSE OBLIGATOIRE :
Utilise STRICTEMENT les titres Markdown de niveau 2 (##) pour chaque section.

## 🎯 Résumé de l’objectif d’apprentissage
[Résumé concis basé sur le sujet ou le document.]

## 🧩 Découpage des modules / compétences
[Liste des modules clés.]

## 📅 Planning détaillé
[Plan structuré Semaine/Jour. Format obligatoire : 
Semaine X: Titre
Jour Y: Titre [Source]]

## 📚 Ressources recommandées
[Introduction générale. Les liens seront gérés par l'outil.]

## 📝 Mini quiz d’évaluation
[3 à 5 questions.]

## 🚀 Conseil pédagogique final
[Conseil motivant.]

TON : Professionnel, structuré, bienveillant.
`;

  const userPrompt = pdfFile 
    ? `Analyse le document PDF fourni ci-joint. Crée un plan d'étude basé sur ce document. Contexte supplémentaire ou focus spécifique demandé par l'utilisateur : "${topic}".`
    : `Sujet d'étude : ${topic}`;

  // Construct the content parts
  const parts: any[] = [];

  // Add PDF if present
  if (pdfFile) {
    parts.push({
      inlineData: {
        data: pdfFile.data,
        mimeType: pdfFile.mimeType
      }
    });
  }

  // Add the text prompt (System instructions + User request)
  parts.push({ text: `${systemPrompt}\n\n${userPrompt}` });

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: "gemini-3-flash-preview", // Supports multimodal input (PDFs) and long context.
      contents: { parts: parts },
      config: {
        tools: [{ googleSearch: {} }], // Enable Google Search for resource finding.
        temperature: 0.7, 
        topK: 40,
        topP: 0.95,
      },
    });

    const text = response.text || '';
    const groundingChunks: GroundingChunkWeb[] = [];
    
    // Extract web URLs from grounding chunks returned by the Google Search tool.
    if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      for (const chunk of response.candidates[0].groundingMetadata.groundingChunks) {
        if (chunk.web) {
          groundingChunks.push(chunk as GroundingChunkWeb);
        }
      }
    }

    return { text, groundingChunks };
  } catch (error: unknown) {
    console.error("Error generating study plan:", error);
    // Provide a user-friendly error message.
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Échec de la génération du plan d'étude. Détails: ${errorMessage}`);
  }
};