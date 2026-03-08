let recognition = null;

export const initSpeechRecognition = () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-IN'; 
  return recognition;
};

export const startSpeechRecognition = (onResult, onError) => {
  if (!recognition) initSpeechRecognition();
  if (!recognition) return false;
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(result => result[0].transcript).join('');
    onResult?.(transcript);
  };
  recognition.start();
  return true;
};

export const stopSpeechRecognition = () => {
  if (recognition) recognition.stop();
};

export default {
  loadModel: async function(config) {
    console.log('[MockSDK] System Online ✅');
    
    return {
      transcribe: async () => ({ text: '' }),
      
      generate: async (prompt, options) => {
        console.log("[MockSDK] AI Ko Ye Sawaal Mila:", prompt); // DEBUG KE LIYE
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const lowerPrompt = prompt.toLowerCase();
        
        // 1. INSTANT REPLY (Logger)
        if (lowerPrompt.includes('reply with only 3-4 words') || lowerPrompt.includes('haan, save ho gaya')) {
          return { text: "Haan, maine save kar liya hai." };
        }
        
        // 2. SAVING DATA (Fact Extraction)
        if (lowerPrompt.includes('extract it into a 1-line json fact')) {
          const extractMatch = prompt.match(/Analyze this text: "([^"]+)"/i);
          const userText = extractMatch ? extractMatch[1] : "";
          const lowerUserText = userText.toLowerCase();

          // Agar user ne hello ya free bola, toh reject karo
          if (lowerUserText.includes('hello') || lowerUserText.includes('hi ') || lowerUserText.includes('free') || userText.length < 4) {
             return { text: JSON.stringify({ fact: "", score: 1 }) };
          }
          // Baki KUCH BHI bola, usko save kar lo!
          return { text: JSON.stringify({ fact: userText, score: 9 }) };
        }
        
        // 3. ASSISTANT CHAT (Genius Mode)
        if (lowerPrompt.includes('highly intelligent') || lowerPrompt.includes('think deeply')) {
          const queryMatch = prompt.match(/User's Question: "([^"]+)"/i);
          const userQuery = queryMatch ? queryMatch[1].toLowerCase() : '';
          
          const dataMatch = prompt.match(/User's Data for today:\s*([\s\S]*?)\s*User's Question:/i);
          const rawDataText = dataMatch ? dataMatch[1].trim() : '';
          
          if (userQuery.includes('hello') || userQuery.includes('hi')) {
            return { text: "Hello! Main SENTINEL hoon. Bataiye, aaj kya plan hai?" };
          }
          if (userQuery.includes('schedule') || userQuery.includes('din') || userQuery.includes('kya')) {
            if (rawDataText === '' || rawDataText.includes('koi task nahi')) {
              return { text: "Aapke paas aaj koi task save nahi hai. Din bilkul free hai!" };
            } else {
              return { text: `Ji, aapka aaj ka data ye hai: ${rawDataText}. Sab kuch set hai!` };
            }
          }
          return { text: "Samajh gaya. Main aapke schedule ko track kar raha hoon." };
        }
        
        // 4. CONFLICT
        if (lowerPrompt.includes('conflict')) {
          return { text: JSON.stringify({ hasConflict: false, conflictWith: '', confidence: 0 }) };
        }
        
        return { text: 'Done' };
      }
    };
  }
};