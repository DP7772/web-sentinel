import localforage from 'localforage';

localforage.config({
  name: 'SENTINEL_Vault',
  storeName: 'facts',
  description: 'SENTINEL Memory Vault for commitments and tasks'
});

export const initDB = async () => {
  try {
    await localforage.ready();
    console.log('[SENTINEL] IndexedDB initialized');
    return true;
  } catch (error) {
    console.error('[SENTINEL] IndexedDB init failed:', error);
    return false;
  }
};

export const saveFact = async (fact, score) => {
  try {
    const timestamp = Date.now();
    const dateKey = new Date().toISOString().split('T')[0];
    
    const factEntry = {
      id: `fact_${timestamp}`,
      content: fact,
      score: score,
      timestamp: timestamp,
      dateKey: dateKey,
      rawText: ''
    };

    await localforage.setItem(factEntry.id, factEntry);
    console.log('[SENTINEL] Fact saved:', factEntry.id);
    return factEntry;
  } catch (error) {
    console.error('[SENTINEL] Failed to save fact:', error);
    throw error;
  }
};

export const getFactsByDate = async (dateKey) => {
  try {
    const facts = [];
    await localforage.iterate((value, key) => {
      if (value.dateKey === dateKey && value.score >= 7) {
        facts.push(value);
      }
    });
    return facts.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('[SENTINEL] Failed to get facts by date:', error);
    return [];
  }
};

export const getAllFacts = async () => {
  try {
    const factsByDate = {};
    await localforage.iterate((value, key) => {
      if (value.score >= 7) {
        const dateKey = value.dateKey;
        if (!factsByDate[dateKey]) {
          factsByDate[dateKey] = [];
        }
        factsByDate[dateKey].push(value);
      }
    });
    
    Object.keys(factsByDate).forEach(dateKey => {
      factsByDate[dateKey].sort((a, b) => b.timestamp - a.timestamp);
    });
    
    return factsByDate;
  } catch (error) {
    console.error('[SENTINEL] Failed to get all facts:', error);
    return {};
  }
};

export const getTodayFacts = async () => {
  const today = new Date().toISOString().split('T')[0];
  return getFactsByDate(today);
};

export const deleteFact = async (factId) => {
  try {
    await localforage.removeItem(factId);
    console.log('[SENTINEL] Fact deleted:', factId);
    return true;
  } catch (error) {
    console.error('[SENTINEL] Failed to delete fact:', error);
    return false;
  }
};

export const deleteAllFactsForDate = async (dateKey) => {
  try {
    const facts = await getFactsByDate(dateKey);
    const deletePromises = facts.map(fact => localforage.removeItem(fact.id));
    await Promise.all(deletePromises);
    console.log('[SENTINEL] All facts deleted for date:', dateKey);
    return true;
  } catch (error) {
    console.error('[SENTINEL] Failed to delete facts for date:', error);
    return false;
  }
};

export const getFactCount = async () => {
  let count = 0;
  await localforage.iterate((value, key) => {
    if (value.score >= 7) {
      count++;
    }
  });
  return count;
};
