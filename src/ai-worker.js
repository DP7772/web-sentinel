let runAnywhere = null;
let whisper = null;
let llm = null;
let isInitialized = false;
let isProcessing = false;

const ANALYSIS_PROMPT = `Analyze this Hinglish/Hindi/English text. If it contains a commitment, time, location, or actionable task, extract it into a 1-line JSON fact with a score > 7. Include the time/date if mentioned. Format: {"fact": "specific commitment with time", "score": 0-10, "time": "time mentioned or null", "type": "meeting/call/task/deadline"}`;

const CONFLICT_PROMPT = `You are a conflict detection system. Given the new commitment and existing commitments for today, determine if there are time conflicts or duplicate tasks. Return JSON: {"hasConflict": boolean, "conflictWith": "description of conflicting fact", "confidence": 0-1, "reason": "why it's a conflict"}`;

self.onmessage = async (event) => {
  const { type, payload, id } = event.data;

  try {
    switch (type) {
      case 'INIT':
        await initializeSDK(payload);
        break;
      case 'TRANSCRIBE_AUDIO':
        await transcribeAudio(payload.audioData);
        break;
      case 'PROCESS_TEXT':
        await processText(payload.text, payload.todayFacts);
        break;
      case 'CHECK_CONFLICT':
        await checkConflict(payload.newFact, payload.existingFacts);
        break;
      case 'QUERY_SUMMARY':
      case 'ASSISTANT_CHAT':
        // Ab dono cases seedha hamare Smart Assistant ke paas jayenge
        await handleAssistantChat(payload.text, payload.todayFacts);
        break;
      default:
        postMessage({ type: 'ERROR', error: `Unknown message type: ${type}` });
    }
  } catch (error) {
    postMessage({ 
      type: 'ERROR', 
      error: error.message,
      id 
    });
  }
};

async function initializeSDK(config) {
  if (isInitialized) {
    postMessage({ type: 'INIT_COMPLETE', status: 'already_initialized' });
    return;
  }

  try {
    postMessage({ type: 'INIT_STATUS', status: 'loading', message: 'Loading RunAnywhere SDK...' });

    const RunAnywhere = await import('./runanywhere-sdk.js');
    runAnywhere = RunAnywhere.default;

    postMessage({ type: 'INIT_STATUS', status: 'loading', message: 'Initializing Whisper-tiny...' });
    
    whisper = await runAnywhere.loadModel({
      model: 'whisper-tiny',
      device: 'webgpu',
      progress: (progress) => {
        postMessage({ 
          type: 'INIT_PROGRESS', 
          model: 'whisper',
          progress: progress * 0.5
        });
      }
    });

    postMessage({ type: 'INIT_STATUS', status: 'loading', message: 'Initializing SmolLM2-135M...' });
    
    llm = await runAnywhere.loadModel({
      model: 'smollm2-135m',
      device: 'webgpu',
      progress: (progress) => {
        postMessage({ 
          type: 'INIT_PROGRESS', 
          model: 'llm',
          progress: 0.5 + (progress * 0.5)
        });
      }
    });

    isInitialized = true;
    postMessage({ type: 'INIT_COMPLETE', status: 'success' });
    console.log('[SENTINEL Worker] SDK initialized successfully');
  } catch (error) {
    console.error('[SENTINEL Worker] Init failed:', error);
    postMessage({ 
      type: 'INIT_COMPLETE', 
      status: 'error',
      error: error.message 
    });
  }
}

async function transcribeAudio(audioData) {
  if (!isInitialized || !whisper) {
    postMessage({ type: 'TRANSCRIPTION_ERROR', error: 'Whisper not initialized' });
    return;
  }

  if (isProcessing) {
    postMessage({ type: 'TRANSCRIPTION_ERROR', error: 'Already processing audio' });
    return;
  }

  isProcessing = true;

  try {
    postMessage({ type: 'TRANSCRIPTION_START' });

    const audioBuffer = new Uint8Array(audioData);
    
    const result = await whisper.transcribe(audioBuffer, {
      language: 'auto',
      temperature: 0.0,
      beam_size: 1
    });

    const transcription = result.text?.trim() || '';
    
    postMessage({ type: 'TRANSCRIPTION_COMPLETE', text: transcription });

    if (transcription.length > 0) {
      postMessage({ type: 'TEXT_DETECTED', text: transcription });
    }
  } catch (error) {
    console.error('[SENTINEL Worker] Transcription error:', error);
    postMessage({ type: 'TRANSCRIPTION_ERROR', error: error.message });
  } finally {
    isProcessing = false;
  }
}

async function processText(text, todayFacts) {
  if (!isInitialized || !llm) {
    postMessage({ type: 'PROCESSING_ERROR', error: 'LLM not initialized' });
    return;
  }

  if (!text || text.trim().length === 0) {
    return;
  }

  try {
    postMessage({ type: 'ANALYSIS_START', text: text });

    // STRICT PROMPT: Sirf tasks ko pakdega
    const prompt = `Analyze this text: "${text}"
If it is a specific commitment, meeting, or task, extract it into a 1-line JSON fact with a score between 8 to 10.
If it is just casual chat or saying "I am free", score it 1.
Format MUST BE strictly: {"fact": "the task", "score": number}`;

    const response = await llm.generate(prompt, {
      max_tokens: 100,
      temperature: 0.1,
      top_p: 0.9
    });

    let parsedResult = parseLLMResponse(response.text);

    if (parsedResult.score >= 7 && parsedResult.fact && parsedResult.fact.length > 3) {
      // Sona (Gold) mil gaya! Save karne ke liye UI ko bhejo
      postMessage({ 
        type: 'FACT_EXTRACTED', 
        fact: parsedResult.fact,
        score: parsedResult.score,
        rawText: text 
      });

      // INSTANT TEXT REPLY (Bina aawaz ke)
      postMessage({
        type: 'AI_RESPONSE',
        message: "Noted! Down Captain",
        originalText: text,
        shouldSpeak: false // 🛑 YAHAN FALSE KAR DIYA HAI (Aawaz band)
      });

      // Save hone ke baad conflict check karo
      if (todayFacts && todayFacts.length > 0) {
        await checkConflict(parsedResult.fact, todayFacts);
      }
    } else {
      // Agar kachra bola (jaise "Main free hoon" ya "Hello")
      postMessage({ 
        type: 'FACT_REJECTED', 
        score: parsedResult.score,
        reason: 'Not a valid task' 
      });

      postMessage({
        type: 'AI_RESPONSE',
        message: "Achha ji! Agar koi naya plan banega toh mujhe batayiyega.",
        originalText: text,
        shouldSpeak: false // 🛑 YAHAN BHI FALSE KAR DIYA HAI
      });
    }
  } catch (error) {
    console.error('[SENTINEL Worker] Processing error:', error);
    postMessage({ type: 'PROCESSING_ERROR', error: error.message });
  }
}


async function checkConflict(newFact, existingFacts) {
  if (!isInitialized || !llm || !existingFacts || existingFacts.length === 0) {
    return;
  }

  try {
    postMessage({ type: 'CONFLICT_CHECK_START' });

    const factsList = existingFacts.map(f => `- ${f.content}`).join('\n');
    const prompt = `${CONFLICT_PROMPT}\n\nNew commitment: "${newFact}"\n\nToday's commitments:\n${factsList}\n\nRespond with JSON only.`;

    const response = await llm.generate(prompt, {
      max_tokens: 256,
      temperature: 0.1,
      top_p: 0.9
    });

    const conflictResult = parseConflictResponse(response.text);

    if (conflictResult.hasConflict && conflictResult.confidence > 0.5) {
      postMessage({
        type: 'CONFLICT_ALERT',
        newFact: newFact,
        conflictWith: conflictResult.conflictWith,
        confidence: conflictResult.confidence,
        reason: conflictResult.reason
      });
    } else {
      const timeConflict = checkTimeConflict(newFact, existingFacts);
      if (timeConflict) {
        postMessage({
          type: 'CONFLICT_ALERT',
          newFact: newFact,
          conflictWith: timeConflict,
          confidence: 0.9,
          reason: 'Same time slot'
        });
      }
    }
  } catch (error) {
    console.error('[SENTINEL Worker] Conflict check error:', error);
  }
}

function checkTimeConflict(newFact, existingFacts) {
  const newFactLower = newFact.toLowerCase();
  
  const timePatterns = [
    { regex: /\b(9|9:00|9am)\b/, label: '9' },
    { regex: /\b(10|10:00|10am)\b/, label: '10' },
    { regex: /\b(11|11:00|11am)\b/, label: '11' },
    { regex: /\b(12|12:00|12pm|noon)\b/, label: '12' },
    { regex: /\b(1|1:00|1pm)\b/, label: '13' },
    { regex: /\b(2|2:00|2pm)\b/, label: '14' },
    { regex: /\b(3|3:00|3pm)\b/, label: '15' },
    { regex: /\b(4|4:00|4pm)\b/, label: '16' },
    { regex: /\b(5|5:00|5pm)\b/, label: '17' },
    { regex: /\b(6|6:00|6pm)\b/, label: '18' },
    { regex: /\b(7|7:00|7pm)\b/, label: '19' },
    { regex: /\b(8|8:00|8pm)\b/, label: '20' }
  ];
  
  const newTime = timePatterns.find(t => t.regex.test(newFactLower));
  if (!newTime) return null;
  
  for (const existing of existingFacts) {
    const existingLower = existing.content.toLowerCase();
    if (timePatterns.some(t => t.regex.test(existingLower) && t.label === newTime.label)) {
      return existing.content;
    }
  }
  
  return null;
}

// THE GENIUS ASSISTANT ENGINE
async function handleAssistantChat(queryText, todayFacts) {
  if (!isInitialized || !llm) {
    postMessage({ type: 'PROCESSING_ERROR', error: 'LLM not initialized' });
    return;
  }

  try {
    postMessage({ type: 'ANALYSIS_START', text: queryText });

    const factsList = todayFacts && todayFacts.length > 0
      ? todayFacts.map((f, i) => `${i + 1}. ${f.content}`).join('\n')
      : "User ke paas aaj koi task nahi hai.";

    // THE "GENIUS MODE" PROMPT WITH TEMPERATURE 0.7
    const prompt = `You are SENTINEL, a highly intelligent, logical, and observant AI assistant (like Google Assistant).

User's Data for today:
${factsList}

User's Question: "${queryText}"

Instructions for your perfect response:
1. THINK DEEPLY: Analyze what the user is actually asking.
2. If they ask about their day, connect the tasks logically (e.g., "Aapki 2 baje meeting hai, uske baad 5 baje gym jana hai").
3. If it's a general conversation (like "Hello" or "Kaise ho"), reply smartly and warmly.
4. If they ask a complex question about their schedule, give a precise, perfectly calculated answer.
5. Tone: Helpful, highly intelligent, and conversational Hinglish. 
6. Do NOT use markdown (* or #). Speak like a human.

Tum ek professional assistant ho jiska naam SENTINEL hai. 
Niche diye gaye data ko padho aur user ke sawal ka jawab do.

ZAROORI: Agar two or more than two  tasks ka time SAME hai (jaise dono 5:00 PM par hain), 
toh jawab dete waqt user ko saaf-saaf bolo: 
"Captain, ek chota sa conflict hai, aapke do kaam ek hi time par scheduled hain." 
Uske baad hi list sunao.
`;

    const response = await llm.generate(prompt, {
      max_tokens: 200, 
      temperature: 0.7, // High temp for natural conversational flow
      top_p: 0.9
    });

    postMessage({
      type: 'AI_RESPONSE',
      message: response.text.trim(),
      originalText: queryText,
      shouldSpeak: true // Hamesha bol ke jawab dega
    });

  } catch (error) {
    console.error('[SENTINEL Worker] Chat error:', error);
    postMessage({
      type: 'AI_RESPONSE',
      message: "Main network ya memory issue face kar raha hoon. Ek baar fir bolenge?",
      originalText: queryText,
      shouldSpeak: true
    });
  }
}

function parseLLMResponse(text) {
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        fact: parsed.fact || '',
        score: typeof parsed.score === 'number' ? parsed.score : 0
      };
    }
  } catch (error) {
    console.warn('[SENTINEL Worker] Failed to parse LLM response:', text);
  }
  
  return { fact: text.trim(), score: 5 };
}

function parseConflictResponse(text) {
  try {
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        hasConflict: Boolean(parsed.hasConflict),
        conflictWith: parsed.conflictWith || '',
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0
      };
    }
  } catch (error) {
    console.warn('[SENTINEL Worker] Failed to parse conflict response:', text);
  }
  
  return { hasConflict: false, conflictWith: '', confidence: 0 };
}

export {};